//! Per-core epoll reactor for live-tail readers — SSE subscribers and caught-up
//! long-polls (Linux only).
//!
//! A live reader otherwise costs a whole connection task future (sized to the
//! largest request handler) parked for the wait — up to `SSE_MAX_DURATION` for an
//! SSE subscriber, up to the long-poll timeout for a caught-up poll. At fan-out
//! scale that per-connection future is the dominant resident cost. This reactor
//! instead holds each reader as a compact slab entry on a fixed pool of
//! `N = available_parallelism()` dedicated threads (one epoll instance each): task
//! count stays constant, and per-reader userspace collapses to the slab entry plus
//! the kernel socket.
//!
//! The two modes share all the machinery (slab, epoll arm/flush/backpressure,
//! cross-thread wake, lifetime sweep) and differ only in what they produce on a
//! wake and what they do when finished (`Kind`):
//!   - **SSE** streams chunked `data`/`control` events for the connection's whole
//!     lifetime, then closes (the client reconnects).
//!   - **long-poll** writes one complete fixed-length response when the tail
//!     advances (or on close/timeout), then hands the socket back to the async
//!     connection loop so a keep-alive client's next poll reuses it.
//!
//! Only the live-tail case runs here (root stream, tiering off, start at/after the
//! live file base). Cold catch-up keeps the proven inline path in `engine_raw`.

use std::os::fd::{FromRawFd, IntoRawFd, RawFd};
use std::os::unix::fs::FileExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use bytes::{Bytes, BytesMut};

use crate::api::{LongPollReg, Resp, SseReg};
use crate::handlers::SseEncoding;
use crate::store::{Store, StreamState, StreamSubs, SubHandle, Tail};

/// Idle heartbeat interval and total subscriber lifetime — mirror the inline
/// path (`handlers::SSE_KEEPALIVE` / `SSE_MAX_DURATION`) so client behaviour is
/// unchanged whichever path serves the stream.
const KEEPALIVE: Duration = Duration::from_secs(15);
const MAX_DURATION: Duration = Duration::from_secs(60);
/// epoll_wait timeout: drives the keepalive/lifetime sweep when no I/O occurs.
const TICK_MS: i32 = 1000;
/// Per-subscriber backpressure cap: a consumer that lets this much framed data
/// queue unsent is closed (it reconnects from its last offset). Bounds the only
/// growable per-sub allocation.
const PENDING_CAP: usize = 8 * 1024 * 1024;
const MAX_EVENTS: usize = 256;
/// epoll token marking the cross-thread wakeup eventfd (real subs use slab keys,
/// always `< u64::MAX`).
const EVENTFD_TOKEN: u64 = u64::MAX;

static POOL: OnceLock<Vec<Arc<Shard>>> = OnceLock::new();
static SHUTDOWN: AtomicBool = AtomicBool::new(false);

/// Cross-thread inbox for one reactor thread. The thread owns its epoll fd and
/// slab privately; producers reach it only through these queues + the eventfd.
struct Shard {
    eventfd: RawFd,
    /// New subscribers awaiting registration (pushed by connection tasks).
    intake: Mutex<Vec<Registration>>,
    /// Subscribers with freshly-published data, by `(slab key, generation)`
    /// (pushed by the append path). The generation guards against the slot being
    /// freed and reused before the wake is drained.
    wake: Mutex<Vec<(u32, u32)>>,
}

/// A reader handed from a connection task to the reactor.
struct Registration {
    fd: RawFd,
    st: Arc<StreamState>,
    /// Initial `pending` bytes: the raw chunked-response head for SSE (sent before
    /// the first event), empty for long-poll (which builds its whole response,
    /// head included, only once it has an outcome).
    head: Vec<u8>,
    permit: tokio::sync::OwnedSemaphorePermit,
    kind: RegKind,
}

/// Mode-specific registration payload. The reactor thread turns this into a
/// `Kind` at `insert` (stamping per-reader timestamps then).
enum RegKind {
    Sse {
        write_off: u64,
        encoding: SseEncoding,
        client_cursor: Option<u64>,
    },
    LongPoll {
        from: u64,
        client_cursor: Option<u64>,
        keep_alive: bool,
        /// Any bytes the client pipelined behind its poll; handed back to the async
        /// loop with the socket so it re-parses them as the next request.
        leftover: BytesMut,
        store: Arc<Store>,
    },
}

/// Resident per-reader state. `pending`/`sent` are the only growable parts, and
/// only while a socket is backpressured; an idle reader carries an empty buffer.
struct Sub {
    fd: RawFd,
    st: Arc<StreamState>,
    /// Framed bytes not yet written; `pending[sent..]` is the unwritten tail.
    pending: Vec<u8>,
    sent: usize,
    /// Response fully queued; finish (close or hand-back) once `pending` drains.
    done: bool,
    epollout_armed: bool,
    kind: Kind,
    _permit: tokio::sync::OwnedSemaphorePermit,
}

/// Per-reader mode + its state. Sized to the larger variant; the extra bytes over
/// a single-mode `Sub` are dwarfed by `pending` and the 64 KiB kernel socket.
enum Kind {
    Sse(SseState),
    LongPoll(LongPollState),
}

struct SseState {
    /// Stream byte offset delivered (framed) so far.
    write_off: u64,
    /// Offset at registration — gates the one-shot initial caught-up control.
    start: u64,
    encoding: SseEncoding,
    client_cursor: Option<u64>,
    registered_at: Instant,
    last_event: Instant,
    sent_initial: bool,
}

struct LongPollState {
    /// Offset the poll is caught up at; the response delivers `from..tail`.
    from: u64,
    client_cursor: Option<u64>,
    keep_alive: bool,
    /// When an idle poll returns the up-to-date `204` timeout.
    deadline: Instant,
    /// Bytes the client pipelined behind its poll; handed back with the socket so
    /// the async loop re-parses them as the next request.
    leftover: BytesMut,
    store: Arc<Store>,
}

struct Slot {
    /// Bumped on free so a stale `(key, gen)` wake for the previous occupant is
    /// ignored.
    gen: u32,
    sub: Option<Sub>,
}

// ---- public entry points (called from the tokio runtime / append path) ----

/// Hand a live-tail SSE socket to the reactor. Takes ownership of the socket fd
/// (and the connection-limiter permit, so the connection stays counted) — the
/// tokio task returns immediately afterward. Best-effort: a fd-extraction failure
/// just drops the connection.
pub fn register(stream: tokio::net::TcpStream, head: Vec<u8>, reg: SseReg, permit: tokio::sync::OwnedSemaphorePermit) {
    enqueue(
        stream,
        head,
        reg.st,
        RegKind::Sse {
            write_off: reg.start,
            encoding: reg.encoding,
            client_cursor: reg.client_cursor,
        },
        permit,
    );
}

/// Hand a caught-up long-poll socket to the reactor. The reactor waits at the
/// tail and writes the single response on data/close/timeout (no head is sent
/// up front — it depends on the outcome), then hands the socket back to the async
/// loop for keep-alive (or closes it). Takes ownership of the socket fd and the
/// connection-limiter permit; best-effort, like `register`.
pub fn register_long_poll(
    stream: tokio::net::TcpStream,
    reg: LongPollReg,
    leftover: BytesMut,
    store: Arc<Store>,
    permit: tokio::sync::OwnedSemaphorePermit,
) {
    enqueue(
        stream,
        Vec::new(),
        reg.st,
        RegKind::LongPoll {
            from: reg.from,
            client_cursor: reg.client_cursor,
            keep_alive: reg.keep_alive,
            leftover,
            store,
        },
        permit,
    );
}

/// Shared hand-off: extract the raw fd, make it non-blocking, and queue it on a
/// shard. Best-effort — a fd-extraction failure or an in-progress shutdown drops
/// the connection (and releases the permit).
fn enqueue(
    stream: tokio::net::TcpStream,
    head: Vec<u8>,
    st: Arc<StreamState>,
    kind: RegKind,
    permit: tokio::sync::OwnedSemaphorePermit,
) {
    let std_stream = match stream.into_std() {
        Ok(s) => s,
        Err(_) => return,
    };
    let _ = std_stream.set_nonblocking(true);
    let fd = std_stream.into_raw_fd();
    // If shutdown has begun, the target reactor may already have run `close_all`
    // and exited, which would leak this fd + permit. Close it and let the permit
    // drop instead.
    if SHUTDOWN.load(Ordering::Relaxed) {
        unsafe {
            libc::close(fd);
        }
        return;
    }
    let pool = pool();
    let shard = &pool[(fd as usize) % pool.len()];
    shard.intake.lock().unwrap().push(Registration {
        fd,
        st,
        head,
        permit,
        kind,
    });
    signal(shard.eventfd);
}

/// Wake every reactor subscriber of `st` after its durable tail advanced. O(subs
/// of this stream); idle streams (the common case) have no list and cost nothing.
pub fn wake_stream(st: &StreamState) {
    let mut to_signal: Vec<u16> = Vec::new();
    {
        // Check for subscribers BEFORE touching the pool: a stream (or whole
        // server) with no live readers never spawns a reactor thread.
        let guard = st.reactor_subs.lock().unwrap();
        let Some(list) = guard.as_ref() else { return };
        // Subscribers exist only because `register` ran, so the pool is live.
        let pool = pool();
        for h in &list.subs {
            pool[h.shard as usize].wake.lock().unwrap().push((h.key, h.gen));
            if !to_signal.contains(&h.shard) {
                to_signal.push(h.shard);
            }
        }
    }
    let pool = pool();
    for s in to_signal {
        signal(pool[s as usize].eventfd);
    }
}

/// Begin draining: close every subscriber (releasing its permit) so server
/// shutdown's `drain()` doesn't wait out the full grace period. No-op if no
/// reactor thread was ever started.
pub fn shutdown() {
    SHUTDOWN.store(true, Ordering::Relaxed);
    if let Some(pool) = POOL.get() {
        for s in pool {
            signal(s.eventfd);
        }
    }
}

fn pool() -> &'static Vec<Arc<Shard>> {
    POOL.get_or_init(|| {
        let n = std::thread::available_parallelism()
            .map(|x| x.get())
            .unwrap_or(4);
        let mut shards = Vec::with_capacity(n);
        for i in 0..n {
            let eventfd = unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC) };
            let shard = Arc::new(Shard {
                eventfd,
                intake: Mutex::new(Vec::new()),
                wake: Mutex::new(Vec::new()),
            });
            let me = shard.clone();
            std::thread::Builder::new()
                .name(format!("reactor-{i}"))
                .spawn(move || Reactor::new(me, i as u16).run())
                .expect("spawn reactor thread");
            shards.push(shard);
        }
        shards
    })
}

fn signal(eventfd: RawFd) {
    let v: u64 = 1;
    unsafe {
        libc::write(eventfd, &v as *const u64 as *const libc::c_void, 8);
    }
}

// ---- the reactor thread ----

struct Reactor {
    shard: Arc<Shard>,
    shard_idx: u16,
    epfd: RawFd,
    slab: Vec<Slot>,
    free: Vec<u32>,
}

impl Reactor {
    fn new(shard: Arc<Shard>, shard_idx: u16) -> Reactor {
        let epfd = unsafe { libc::epoll_create1(libc::EPOLL_CLOEXEC) };
        // Register the wakeup eventfd. EPOLLIN level-triggered; drained each wake.
        let mut ev = libc::epoll_event {
            events: libc::EPOLLIN as u32,
            u64: EVENTFD_TOKEN,
        };
        unsafe {
            libc::epoll_ctl(epfd, libc::EPOLL_CTL_ADD, shard.eventfd, &mut ev);
        }
        Reactor {
            shard,
            shard_idx,
            epfd,
            slab: Vec::new(),
            free: Vec::new(),
        }
    }

    fn run(mut self) {
        let mut events = vec![libc::epoll_event { events: 0, u64: 0 }; MAX_EVENTS];
        loop {
            if SHUTDOWN.load(Ordering::Relaxed) {
                self.close_all();
                return;
            }
            let n = unsafe {
                libc::epoll_wait(self.epfd, events.as_mut_ptr(), MAX_EVENTS as i32, TICK_MS)
            };
            if n < 0 {
                // EINTR or similar: re-arm the loop (shutdown re-checked at top).
                continue;
            }
            let mut got_wakeup = false;
            for ev in events.iter().take(n as usize) {
                let token = ev.u64;
                let flags = ev.events;
                if token == EVENTFD_TOKEN {
                    got_wakeup = true;
                    drain_eventfd(self.shard.eventfd);
                    continue;
                }
                let key = token as u32;
                if flags & (libc::EPOLLHUP as u32 | libc::EPOLLERR as u32 | libc::EPOLLRDHUP as u32)
                    != 0
                {
                    self.close(key);
                    continue;
                }
                if flags & libc::EPOLLOUT as u32 != 0 {
                    self.flush(key);
                }
            }
            if got_wakeup {
                let intake: Vec<Registration> =
                    std::mem::take(&mut *self.shard.intake.lock().unwrap());
                for reg in intake {
                    self.insert(reg);
                }
                let wakes: Vec<(u32, u32)> = std::mem::take(&mut *self.shard.wake.lock().unwrap());
                for (key, gen) in wakes {
                    if self
                        .slab
                        .get(key as usize)
                        .is_some_and(|s| s.gen == gen && s.sub.is_some())
                    {
                        self.produce(key);
                        self.flush(key);
                    }
                }
            }
            self.tick();
        }
    }

    /// Register a new subscriber: seat it in the slab, link it on its stream,
    /// arm epoll, and emit its first frame(s).
    fn insert(&mut self, reg: Registration) {
        let key = match self.free.pop() {
            Some(k) => k,
            None => {
                self.slab.push(Slot { gen: 0, sub: None });
                (self.slab.len() - 1) as u32
            }
        };
        let gen = self.slab[key as usize].gen;
        let now = Instant::now();
        let st = reg.st.clone();
        let kind = match reg.kind {
            RegKind::Sse {
                write_off,
                encoding,
                client_cursor,
            } => Kind::Sse(SseState {
                write_off,
                start: write_off,
                encoding,
                client_cursor,
                registered_at: now,
                last_event: now,
                sent_initial: false,
            }),
            RegKind::LongPoll {
                from,
                client_cursor,
                keep_alive,
                leftover,
                store,
            } => Kind::LongPoll(LongPollState {
                from,
                client_cursor,
                keep_alive,
                deadline: now + crate::handlers::long_poll_timeout_dur(),
                leftover,
                store,
            }),
        };
        self.slab[key as usize].sub = Some(Sub {
            fd: reg.fd,
            st: reg.st,
            pending: reg.head,
            sent: 0,
            done: false,
            epollout_armed: false,
            kind,
            _permit: reg.permit,
        });
        // Link onto the stream so the append path can find and wake this sub.
        {
            let mut g = st.reactor_subs.lock().unwrap();
            g.get_or_insert_with(|| Box::new(StreamSubs { subs: Vec::new() }))
                .subs
                .push(SubHandle {
                    shard: self.shard_idx,
                    key,
                    gen,
                });
        }
        // Watch for peer close/errors; EPOLLOUT is armed lazily by flush().
        let mut ev = libc::epoll_event {
            events: libc::EPOLLRDHUP as u32,
            u64: key as u64,
        };
        unsafe {
            libc::epoll_ctl(self.epfd, libc::EPOLL_CTL_ADD, reg.fd, &mut ev);
        }
        self.produce(key);
        self.flush(key);
    }

    /// Produce the reader's next bytes into `pending`, dispatched by mode. Called
    /// on registration and on every wake; the caller flushes afterwards.
    fn produce(&mut self, key: u32) {
        match self.slab.get(key as usize).and_then(|s| s.sub.as_ref()) {
            Some(sub) if sub.done => {}
            Some(sub) => match &sub.kind {
                Kind::Sse(_) => self.sse_produce(key),
                Kind::LongPoll(_) => self.longpoll_produce(key),
            },
            None => {}
        }
    }

    /// Append the subscriber's next SSE frame(s) — catch-up data + control, a
    /// final close control, or the one-shot initial caught-up control — to
    /// `pending`. A faithful synchronous port of `handlers::SseSource::next`
    /// (minus the async idle wait, which the keepalive sweep covers).
    fn sse_produce(&mut self, key: u32) {
        let sub = match self.slab[key as usize].sub.as_mut() {
            Some(s) if !s.done => s,
            _ => return,
        };
        let Kind::Sse(ss) = &mut sub.kind else { return };
        loop {
            let (file, file_base, tail, closed) = {
                let s = sub.st.shared.read().unwrap();
                (s.file.clone(), s.file_base, s.durable_tail, s.closed_durable)
            };
            if tail > ss.write_off {
                if ss.write_off < file_base {
                    // The needed bytes were compacted out of the live file; end the
                    // stream (the client reconnects, routing through the cold path).
                    sub.done = true;
                    frame_terminator(&mut sub.pending);
                    return;
                }
                let want = (tail - ss.write_off) as usize;
                let mut data = vec![0u8; want];
                if pread_exact(&file, ss.write_off - file_base, &mut data).is_err() {
                    sub.done = true;
                    frame_terminator(&mut sub.pending);
                    return;
                }
                let mut ev = String::new();
                crate::handlers::sse_encode_data(&mut ev, &data, ss.encoding);
                ss.write_off = tail;
                let cur = sub.st.tail();
                let up_to_date = ss.write_off >= cur.bytes;
                let closed_now = closed && ss.write_off >= tail;
                crate::handlers::sse_control_event(
                    &mut ev,
                    ss.write_off,
                    crate::store::compute_cursor(ss.client_cursor),
                    up_to_date,
                    closed_now,
                );
                push_frame(&mut sub.pending, &mut sub.sent, ev.as_bytes());
                ss.last_event = Instant::now();
                if closed_now {
                    sub.done = true;
                    frame_terminator(&mut sub.pending);
                    return;
                }
                if sub.pending.len() - sub.sent > PENDING_CAP {
                    sub.done = true;
                    return;
                }
                continue;
            }
            if closed && ss.write_off >= tail {
                let mut ev = String::new();
                crate::handlers::sse_control_event(
                    &mut ev,
                    ss.write_off,
                    crate::store::compute_cursor(ss.client_cursor),
                    true,
                    true,
                );
                push_frame(&mut sub.pending, &mut sub.sent, ev.as_bytes());
                ss.last_event = Instant::now();
                sub.done = true;
                frame_terminator(&mut sub.pending);
                return;
            }
            // Caught up at the live tail with nothing pending: emit the one-shot
            // initial control (parity with the inline path) then go idle.
            if !ss.sent_initial && ss.write_off == ss.start && tail == ss.start && !closed {
                let mut ev = String::new();
                crate::handlers::sse_control_event(
                    &mut ev,
                    ss.write_off,
                    crate::store::compute_cursor(ss.client_cursor),
                    true,
                    false,
                );
                push_frame(&mut sub.pending, &mut sub.sent, ev.as_bytes());
                ss.sent_initial = true;
                ss.last_event = Instant::now();
            }
            return;
        }
    }

    /// Build the single long-poll response into `pending` once the wait resolves:
    /// `200` with `from..tail` when the tail advanced, `204` stream-closed when the
    /// writer closed at the tail. Stays idle (queues nothing) while still caught up
    /// and open — the deadline timeout is handled by `longpoll_tick`. Mirrors
    /// `handlers::handle_long_poll`'s post-wait branches via the shared builders.
    fn longpoll_produce(&mut self, key: u32) {
        let (st, from, client_cursor, keep_alive) = {
            let sub = match self.slab[key as usize].sub.as_ref() {
                Some(s) if !s.done => s,
                _ => return,
            };
            let Kind::LongPoll(lp) = &sub.kind else { return };
            (sub.st.clone(), lp.from, lp.client_cursor, lp.keep_alive)
        };
        let (file, file_base, tail, closed) = {
            let s = st.shared.read().unwrap();
            (s.file.clone(), s.file_base, s.durable_tail, s.closed_durable)
        };
        if tail > from {
            if from < file_base {
                // Concurrent compaction dropped the needed bytes from the live
                // file. Close so the client retries and is served the gap through
                // the cold catch-up path.
                self.close(key);
                return;
            }
            let data = match read_hot_range(&st, &file, file_base, from, tail) {
                Some(d) => d,
                None => {
                    self.close(key);
                    return;
                }
            };
            let body = crate::handlers::long_poll_full_body(st.is_json, data);
            let resp = crate::handlers::long_poll_data_resp(
                &st,
                from,
                Tail { bytes: tail, closed },
                client_cursor,
                body,
            );
            self.finalize_longpoll(key, resp, keep_alive);
        } else if closed {
            let resp =
                crate::handlers::long_poll_close(tail, crate::store::compute_cursor(client_cursor));
            self.finalize_longpoll(key, resp, keep_alive);
        }
    }

    /// Queue a fully-built long-poll `Resp` as this reader's complete response and
    /// mark it done; the caller flushes (then `finish` hands the socket back or
    /// closes it).
    fn finalize_longpoll(&mut self, key: u32, resp: Resp, keep_alive: bool) {
        let bytes = serialize_resp(resp, keep_alive);
        if let Some(sub) = self.slab[key as usize].sub.as_mut() {
            // `pending` is normally empty here (long-poll queues nothing before its
            // outcome); compact any sent prefix defensively before appending.
            if sub.sent > 0 {
                sub.pending.drain(0..sub.sent);
                sub.sent = 0;
            }
            sub.pending.extend_from_slice(&bytes);
            sub.done = true;
        }
    }

    /// Write as much of `pending` as the socket accepts. Arms EPOLLOUT on
    /// backpressure, disarms it once drained, and closes the sub on a fatal write
    /// error or after the terminating chunk flushes.
    fn flush(&mut self, key: u32) {
        let sub = match self.slab[key as usize].sub.as_mut() {
            Some(s) => s,
            None => return,
        };
        while sub.sent < sub.pending.len() {
            let buf = &sub.pending[sub.sent..];
            let n = unsafe {
                libc::write(sub.fd, buf.as_ptr() as *const libc::c_void, buf.len())
            };
            if n > 0 {
                sub.sent += n as usize;
                continue;
            }
            if n == 0 {
                // write(2) accepted nothing yet signalled no error: treat the peer
                // as gone. Reading errno here would observe a stale value (the
                // syscall succeeded), risking a spurious EAGAIN re-arm or an EINTR
                // spin.
                self.close(key);
                return;
            }
            let err = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            if err == libc::EAGAIN || err == libc::EWOULDBLOCK {
                self.arm_epollout(key);
                return;
            }
            if err == libc::EINTR {
                continue;
            }
            // EPIPE / ECONNRESET / …: peer is gone.
            self.close(key);
            return;
        }
        // Fully drained.
        sub.pending.clear();
        sub.sent = 0;
        if sub.pending.capacity() > PENDING_CAP {
            sub.pending.shrink_to(4096);
        }
        let done = sub.done;
        if sub.epollout_armed {
            self.disarm_epollout(key);
        }
        if done {
            self.finish(key);
        }
    }

    fn arm_epollout(&mut self, key: u32) {
        let sub = self.slab[key as usize].sub.as_mut().unwrap();
        if sub.epollout_armed {
            return;
        }
        sub.epollout_armed = true;
        let fd = sub.fd;
        let mut ev = libc::epoll_event {
            events: libc::EPOLLRDHUP as u32 | libc::EPOLLOUT as u32,
            u64: key as u64,
        };
        unsafe {
            libc::epoll_ctl(self.epfd, libc::EPOLL_CTL_MOD, fd, &mut ev);
        }
    }

    fn disarm_epollout(&mut self, key: u32) {
        let sub = self.slab[key as usize].sub.as_mut().unwrap();
        if !sub.epollout_armed {
            return;
        }
        sub.epollout_armed = false;
        let fd = sub.fd;
        let mut ev = libc::epoll_event {
            events: libc::EPOLLRDHUP as u32,
            u64: key as u64,
        };
        unsafe {
            libc::epoll_ctl(self.epfd, libc::EPOLL_CTL_MOD, fd, &mut ev);
        }
    }

    /// Per-mode time-driven sweep, driven by the epoll_wait timeout: SSE keepalive
    /// and lifetime cap, long-poll idle timeout. Linear over the shard's subs; fine
    /// at the per-core sub counts this targets.
    fn tick(&mut self) {
        let now = Instant::now();
        for key in 0..self.slab.len() as u32 {
            match self.slab[key as usize].sub.as_ref().map(|s| &s.kind) {
                Some(Kind::Sse(_)) => self.sse_tick(key, now),
                Some(Kind::LongPoll(_)) => self.longpoll_tick(key, now),
                None => {}
            }
        }
    }

    /// SSE keepalive heartbeat + total-lifetime cap for one subscriber.
    fn sse_tick(&mut self, key: u32, now: Instant) {
        let (registered_at, last_event) = match self.slab[key as usize].sub.as_ref() {
            Some(sub) => match &sub.kind {
                Kind::Sse(ss) => (ss.registered_at, ss.last_event),
                _ => return,
            },
            None => return,
        };
        if now.duration_since(registered_at) >= MAX_DURATION {
            // Lifetime cap: end cleanly; the client reconnects from its offset.
            let sub = self.slab[key as usize].sub.as_mut().unwrap();
            if !sub.done {
                sub.done = true;
                frame_terminator(&mut sub.pending);
            }
            self.flush(key);
            return;
        }
        let idle = {
            let sub = self.slab[key as usize].sub.as_ref().unwrap();
            sub.pending.len() == sub.sent && !sub.done && now.duration_since(last_event) >= KEEPALIVE
        };
        if idle {
            let sub = self.slab[key as usize].sub.as_mut().unwrap();
            let Kind::Sse(ss) = &mut sub.kind else { return };
            let mut ev = String::new();
            crate::handlers::sse_control_event(
                &mut ev,
                ss.write_off,
                crate::store::compute_cursor(ss.client_cursor),
                true,
                false,
            );
            ss.last_event = now;
            push_frame(&mut sub.pending, &mut sub.sent, ev.as_bytes());
            self.flush(key);
        }
    }

    /// Long-poll idle timeout: once the deadline passes, deliver any data/close
    /// that arrived right at the wire (an append whose wake hasn't been drained
    /// yet), otherwise write the up-to-date `204` timeout. Idle ticks before the
    /// deadline return immediately.
    fn longpoll_tick(&mut self, key: u32, now: Instant) {
        let deadline = match self.slab[key as usize].sub.as_ref() {
            Some(sub) if !sub.done => match &sub.kind {
                Kind::LongPoll(lp) => lp.deadline,
                _ => return,
            },
            _ => return,
        };
        if now < deadline {
            return;
        }
        self.longpoll_produce(key);
        let needs_timeout = matches!(
            self.slab[key as usize].sub.as_ref(),
            Some(sub) if !sub.done
        );
        if needs_timeout {
            let (st, client_cursor, keep_alive) = {
                let sub = self.slab[key as usize].sub.as_ref().unwrap();
                let Kind::LongPoll(lp) = &sub.kind else { return };
                (sub.st.clone(), lp.client_cursor, lp.keep_alive)
            };
            let t = st.tail();
            let resp = crate::handlers::long_poll_timeout(
                t.bytes,
                crate::store::compute_cursor(client_cursor),
                t.closed,
            );
            self.finalize_longpoll(key, resp, keep_alive);
        }
        self.flush(key);
    }

    /// Tear down a subscriber: drop it from epoll, close the socket, unlink it
    /// from its stream, free the slot (bumping the generation), and release the
    /// permit (dropped with the `Sub`).
    fn close(&mut self, key: u32) {
        let Some(sub) = self.slab[key as usize].sub.take() else {
            return;
        };
        unsafe {
            libc::epoll_ctl(self.epfd, libc::EPOLL_CTL_DEL, sub.fd, std::ptr::null_mut());
            libc::close(sub.fd);
        }
        let shard_idx = self.shard_idx;
        {
            let mut g = sub.st.reactor_subs.lock().unwrap();
            if let Some(list) = g.as_mut() {
                list.subs.retain(|h| !(h.shard == shard_idx && h.key == key));
                if list.subs.is_empty() {
                    *g = None;
                }
            }
        }
        self.slab[key as usize].gen = self.slab[key as usize].gen.wrapping_add(1);
        self.free.push(key);
    }

    /// A reader's response fully flushed: a keep-alive long-poll hands its socket
    /// back to the async connection loop so the client's next request is read and
    /// dispatched there (re-registering with the reactor if it is another caught-up
    /// poll); otherwise (SSE, or a `Connection: close` poll) the socket is torn down.
    fn finish(&mut self, key: u32) {
        let keep_alive = matches!(
            self.slab[key as usize].sub.as_ref(),
            Some(Sub { kind: Kind::LongPoll(lp), .. }) if lp.keep_alive
        );
        if keep_alive {
            self.handback(key);
        } else {
            self.close(key);
        }
    }

    /// Hand a keep-alive long-poll socket back to the async connection loop once its
    /// response has flushed, so the client's next request is read and dispatched
    /// there. Drop it from epoll WITHOUT closing the fd, unlink + free the slot (as
    /// `close` does), then adopt the live fd as a std stream and resume `conn_loop`,
    /// seeding it with any bytes the client pipelined behind its poll so they are
    /// re-parsed. The permit moves with it, so the connection stays counted across
    /// the hand-back.
    fn handback(&mut self, key: u32) {
        let Some(sub) = self.slab[key as usize].sub.take() else {
            return;
        };
        let fd = sub.fd;
        unsafe {
            libc::epoll_ctl(self.epfd, libc::EPOLL_CTL_DEL, fd, std::ptr::null_mut());
        }
        let shard_idx = self.shard_idx;
        {
            let mut g = sub.st.reactor_subs.lock().unwrap();
            if let Some(list) = g.as_mut() {
                list.subs.retain(|h| !(h.shard == shard_idx && h.key == key));
                if list.subs.is_empty() {
                    *g = None;
                }
            }
        }
        self.slab[key as usize].gen = self.slab[key as usize].gen.wrapping_add(1);
        self.free.push(key);
        let Kind::LongPoll(lp) = sub.kind else {
            // finish only hands back long-polls; close the fd if this is reached.
            unsafe {
                libc::close(fd);
            }
            return;
        };
        let std_stream = unsafe { std::net::TcpStream::from_raw_fd(fd) };
        crate::engine_raw::resume_after_longpoll(lp.store, std_stream, lp.leftover, sub._permit);
    }

    fn close_all(&mut self) {
        for key in 0..self.slab.len() as u32 {
            self.close(key);
        }
        // Subscribers still queued for registration never became slab entries:
        // close their sockets here (dropping each `Registration` releases its
        // permit) so neither the fd nor the connection-limiter permit leaks — a
        // held permit would make `drain` wait out its full grace period.
        let intake = std::mem::take(&mut *self.shard.intake.lock().unwrap());
        for reg in intake {
            unsafe {
                libc::close(reg.fd);
            }
        }
    }
}

/// Serialize a complete long-poll response (head + optional fixed-length body) to
/// raw socket bytes. Byte-identical to the async engine's `write_response` for the
/// `Empty`/`Full` bodies that long-poll produces (`204` head-only, `200` with
/// `content-length`); never chunked, since the body is fully materialized.
fn serialize_resp(resp: Resp, keep_alive: bool) -> Vec<u8> {
    let body_len = resp.body.len();
    let mut out = Vec::with_capacity(256);
    crate::http1::write_head(&mut out, resp.status, &resp.headers, body_len, keep_alive);
    if !crate::http1::status_has_no_body(resp.status) {
        if let crate::api::Body::Full(b) = resp.body {
            out.extend_from_slice(&b);
        }
    }
    out
}

/// Materialize the wire bytes of a delivered long-poll range from the live data
/// file: the resident tail chunk when it covers the range (shared across readers,
/// no syscall — matching `read_range_body`'s fast path), else a positioned read.
/// `None` on a read error, so the caller closes and the client retries.
fn read_hot_range(
    st: &StreamState,
    file: &std::fs::File,
    file_base: u64,
    from: u64,
    tail: u64,
) -> Option<Bytes> {
    if let Some(b) = st.tail_chunk_slice(from, tail) {
        return Some(b);
    }
    let want = (tail - from) as usize;
    let mut data = vec![0u8; want];
    pread_exact(file, from - file_base, &mut data).ok()?;
    Some(Bytes::from(data))
}

/// Append `frame` as a chunked-transfer frame to `pending`, compacting already
/// written bytes first so the buffer doesn't grow unboundedly across appends.
fn push_frame(pending: &mut Vec<u8>, sent: &mut usize, frame: &[u8]) {
    if *sent > 0 {
        pending.drain(0..*sent);
        *sent = 0;
    }
    crate::http1::frame_chunk(pending, frame);
}

/// Append the terminating chunk (`0\r\n\r\n`) that ends a chunked SSE response.
fn frame_terminator(pending: &mut Vec<u8>) {
    pending.extend_from_slice(b"0\r\n\r\n");
}

fn pread_exact(file: &std::fs::File, mut off: u64, mut buf: &mut [u8]) -> std::io::Result<()> {
    while !buf.is_empty() {
        match file.read_at(buf, off) {
            Ok(0) => return Err(std::io::ErrorKind::UnexpectedEof.into()),
            Ok(n) => {
                let tmp = buf;
                buf = &mut tmp[n..];
                off += n as u64;
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

fn drain_eventfd(eventfd: RawFd) {
    let mut v: u64 = 0;
    loop {
        let n = unsafe { libc::read(eventfd, &mut v as *mut u64 as *mut libc::c_void, 8) };
        if n != 8 {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reactor framing must be byte-identical to the inline path: one chunked
    // frame wrapping a `data` event + a `control` event.
    #[test]
    fn frame_matches_inline_event() {
        let mut inline = String::new();
        crate::handlers::sse_encode_data(&mut inline, b"hello", SseEncoding::Text);
        crate::handlers::sse_control_event(&mut inline, 5, 7, true, false);

        let mut pending = Vec::new();
        let mut sent = 0;
        push_frame(&mut pending, &mut sent, inline.as_bytes());

        let mut expected = Vec::new();
        crate::http1::frame_chunk(&mut expected, inline.as_bytes());
        assert_eq!(pending, expected);
    }

    // push_frame compacts already-sent bytes so the buffer tracks only the
    // unwritten tail.
    #[test]
    fn push_frame_compacts_sent_prefix() {
        let mut pending = Vec::new();
        let mut sent = 0;
        push_frame(&mut pending, &mut sent, b"first");
        sent = pending.len(); // pretend it was all written
        push_frame(&mut pending, &mut sent, b"second");
        assert_eq!(sent, 0);
        let mut expected = Vec::new();
        crate::http1::frame_chunk(&mut expected, b"second");
        assert_eq!(pending, expected);
    }

    #[test]
    fn terminator_is_final_chunk() {
        let mut p = Vec::new();
        frame_terminator(&mut p);
        assert_eq!(p, b"0\r\n\r\n");
    }

    // A long-poll timeout serializes as a bodyless 204, keep-alive honoured.
    #[test]
    fn longpoll_timeout_serializes_204_keepalive() {
        let resp = crate::handlers::long_poll_timeout(42, 7, false);
        let bytes = serialize_resp(resp, true);
        let s = String::from_utf8(bytes).unwrap();
        assert!(s.starts_with("HTTP/1.1 204 No Content\r\n"), "{s:?}");
        assert!(
            s.contains(&format!("stream-next-offset: {}\r\n", crate::store::format_offset(42))),
            "{s:?}"
        );
        assert!(s.contains("stream-up-to-date: true\r\n"), "{s:?}");
        // 204 carries no body and no content-length; keep-alive omits `close`.
        assert!(!s.contains("content-length"), "{s:?}");
        assert!(!s.contains("connection: close"), "{s:?}");
        assert!(s.ends_with("\r\n\r\n"));
    }

    // A non-keep-alive outcome must add `Connection: close`.
    #[test]
    fn longpoll_close_serializes_connection_close() {
        let resp = crate::handlers::long_poll_close(99, 7);
        let bytes = serialize_resp(resp, false);
        let s = String::from_utf8(bytes).unwrap();
        assert!(s.starts_with("HTTP/1.1 204 No Content\r\n"), "{s:?}");
        assert!(s.contains("stream-closed: true\r\n"), "{s:?}");
        assert!(s.contains("connection: close\r\n"), "{s:?}");
    }

    // JSON streams strip the trailing record comma and wrap in `[ ]`; others pass
    // the wire bytes through unchanged. Matches `read_range_body`'s framing.
    #[test]
    fn longpoll_body_json_wraps_and_strips_comma() {
        let data = Bytes::from_static(b"{\"a\":1},{\"b\":2},");
        match crate::handlers::long_poll_full_body(true, data) {
            crate::api::Body::Full(b) => assert_eq!(&b[..], b"[{\"a\":1},{\"b\":2}]"),
            _ => panic!("expected Full body"),
        }
    }

    #[test]
    fn longpoll_body_non_json_passthrough() {
        let data = Bytes::from_static(b"\x00\x01\x02raw");
        match crate::handlers::long_poll_full_body(false, data.clone()) {
            crate::api::Body::Full(b) => assert_eq!(b, data),
            _ => panic!("expected Full body"),
        }
    }
}
