//! io_uring fsync executor for `--durability strict` (Linux only, opt-in via the
//! `strict-uring` feature + `--strict-io-uring`). A single shared ring on one
//! dedicated thread batches many streams' per-stream-file `fdatasync`s into one
//! `io_uring_enter`, replacing `SyncCoalescer`'s per-stream
//! `spawn_blocking(barrier_fsync)`.
//!
//! The whole module is `#[cfg(all(target_os = "linux", feature = "strict-uring"))]`;
//! on any other build it is empty and `--strict-io-uring` falls back to spawn_blocking.
#![cfg(all(target_os = "linux", feature = "strict-uring"))]

use std::collections::{HashMap, VecDeque};
use std::os::fd::{AsRawFd, RawFd};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

static STRICT_URING: OnceLock<Arc<UringFsync>> = OnceLock::new();

/// Install the process-global strict fsync executor (once, at startup).
pub fn install(pool: Arc<UringFsync>) {
    let _ = STRICT_URING.set(pool);
}

/// The installed executor, or `None` (spawn_blocking fallback).
pub fn handle() -> Option<Arc<UringFsync>> {
    STRICT_URING.get().cloned()
}

use io_uring::{opcode, types, IoUring};
use tokio::sync::oneshot;

/// Whether io_uring is usable here: try to build a tiny ring. Returns `false` on
/// old kernels or restricted sandboxes (the default Docker seccomp blocks
/// `io_uring_setup`) — the caller then keeps the spawn_blocking fsync path.
pub fn probe() -> bool {
    IoUring::new(8).is_ok()
}

/// Reserved `user_data` for the eventfd wakeup Read SQE (real fsync ids start at 1).
const UD_EVENTFD: u64 = u64::MAX;
/// Ring depth. Caps SQEs in flight per `io_uring_enter`; larger drains are chunked
/// across multiple submits via the submit-then-retry push pattern.
const RING_ENTRIES: u32 = 4096;

/// One outstanding fsync awaiting its CQE.
struct InFlight {
    /// The caller's oneshot — the CQE handler sends this id's result here.
    tx: oneshot::Sender<std::io::Result<()>>,
    /// Keeps the file (and its fd) alive until the fsync CQE arrives. The SQE
    /// references the raw fd, so dropping the `Arc<File>` before the CQE would be a
    /// use-after-free.
    _file: Arc<std::fs::File>,
}

/// Shared state between the async callers and the dedicated ring thread.
struct Shared {
    /// Pending submissions: (user_data id, fd to fdatasync). Appenders push;
    /// the ring thread drains.
    queue: Mutex<VecDeque<(u64, RawFd)>>,
    /// In-flight fsyncs awaiting their CQE, keyed by user_data id. Each id maps to
    /// exactly one `InFlight`, so the CQE handler never cross-wires results.
    inflight: Mutex<HashMap<u64, InFlight>>,
    /// True while the thread is awake and guaranteed to drain again before sleeping.
    armed: AtomicBool,
    /// Monotonic id source (starts at 1; never reaches `UD_EVENTFD`).
    next_id: AtomicU64,
    eventfd: RawFd,
}

/// Cloneable (via `Arc`) handle to the shared fsync executor.
pub struct UringFsync {
    shared: Arc<Shared>,
}

impl UringFsync {
    /// Submit `file`'s `fdatasync` to the ring and await its completion.
    ///
    /// Allocates a unique monotonic id, registers `(oneshot::Sender, Arc<File>)` in
    /// the in-flight slab keyed by that id BEFORE enqueueing/waking (so the CQE
    /// handler always finds the entry), enqueues `(id, fd)`, wakes the ring thread,
    /// then awaits this id's oneshot. The `Arc<File>` is held in the slab until the
    /// CQE arrives, keeping the fd alive for the kernel.
    pub async fn fsync(&self, file: Arc<std::fs::File>) -> std::io::Result<()> {
        // Monotonic, starts at 1, wraps only after 2^64-1 fsyncs — never the
        // eventfd sentinel in any realistic run.
        let id = self.shared.next_id.fetch_add(1, Ordering::Relaxed);
        let fd = file.as_raw_fd();
        let (tx, rx) = oneshot::channel();
        // Register BEFORE enqueue/wake so the CQE handler always finds the entry.
        self.shared
            .inflight
            .lock()
            .unwrap()
            .insert(id, InFlight { tx, _file: file });
        self.shared.queue.lock().unwrap().push_back((id, fd));
        // Wake the thread unless it's already armed to drain (amortized wake). The
        // `swap(false)` clears `armed` so the ring thread's next loop re-arms it —
        // matching the lost-wakeup-free protocol in `src/wal/uring.rs`.
        if !self.shared.armed.swap(false, Ordering::AcqRel) {
            let v: u64 = 1;
            // SAFETY: eventfd is a valid fd owned for the executor's lifetime; an
            // 8-byte counter write is the eventfd write contract.
            unsafe {
                libc::write(
                    self.shared.eventfd,
                    &v as *const u64 as *const libc::c_void,
                    8,
                );
            }
        }
        match rx.await {
            Ok(res) => res,
            // Sender dropped without sending ⇒ the ring thread died (fatal path drains
            // every in-flight with Err, but a torn-down thread could also just drop).
            Err(_) => Err(std::io::Error::other(
                "strict io_uring fsync executor stopped",
            )),
        }
    }
}

/// Create the ring + eventfd and spawn the dedicated submitter/reaper thread.
pub fn start() -> std::io::Result<Arc<UringFsync>> {
    let ring = IoUring::new(RING_ENTRIES)?;
    // eventfd for cross-thread wakeups (caller → ring thread).
    let eventfd: RawFd = unsafe { libc::eventfd(0, 0) };
    if eventfd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let shared = Arc::new(Shared {
        queue: Mutex::new(VecDeque::new()),
        inflight: Mutex::new(HashMap::new()),
        armed: AtomicBool::new(false),
        next_id: AtomicU64::new(1),
        eventfd,
    });
    let thread_shared = Arc::clone(&shared);
    std::thread::Builder::new()
        .name("strict-uring-fsync".to_string())
        .spawn(move || run_loop(thread_shared, ring, eventfd))?;
    Ok(Arc::new(UringFsync { shared }))
}

/// The dedicated ring loop.
///
/// # Lost-wakeup-free `armed` protocol (mirrors `src/wal/uring.rs`)
///
/// A caller (`UringFsync::fsync`) pushes its `(id, fd)`, then does
/// `if !armed.swap(false) { write(eventfd) }`: it pays the eventfd syscall only
/// when it observes `armed == false`; when `armed == true` it skips the write but
/// *also clears `armed`*, so the next caller (or this loop's re-check) wakes us.
///
/// The loop never blocks in `submit_and_wait` with work still queued:
///
/// 1. Set `armed = true`, then drain. While armed is true, concurrent callers skip
///    the eventfd (pure wake amortization) — they still push.
/// 2. If the drain produced anything, submit (NON-blocking) and loop immediately
///    (process-more-first): callers that pushed during our drain while `armed ==
///    true` skipped the eventfd, so we must not rely on a wakeup.
/// 3. Only on an EMPTY drain do we consider blocking. We then **clear `armed =
///    false`** and re-check the queue. A caller that pushed after our (2) drain but
///    before this clear may have read `armed == true` and skipped the eventfd, so
///    its item is visible only to this final check; if non-empty we loop without
///    blocking. We call `submit_and_wait` only with `armed == false` AND a
///    subsequent queue read observed empty — so any later push reads `armed ==
///    false` and writes the eventfd, which the armed Read SQE turns into a CQE that
///    returns `submit_and_wait(1)`. No enqueue can sit unserviced.
fn run_loop(shared: Arc<Shared>, mut ring: IoUring, eventfd: RawFd) {
    let mut eventfd_buf: u64 = 0;
    let mut eventfd_armed = false; // is a Read SQE for the eventfd currently in flight?

    loop {
        // (1) Ensure the eventfd Read SQE is armed so caller wakeups land.
        if !eventfd_armed {
            let e = opcode::Read::new(types::Fd(eventfd), &mut eventfd_buf as *mut u64 as *mut u8, 8)
                .build()
                .user_data(UD_EVENTFD);
            // SAFETY: `eventfd_buf` is loop-scoped and outlives the SQE; fd valid.
            if unsafe { push(&mut ring, &e) }.is_err() {
                fatal(&shared);
                return;
            }
            eventfd_armed = true;
        }

        // (2) Arm the wake-skip flag, then drain the queue.
        shared.armed.store(true, Ordering::Release);
        let mut batch: Vec<(u64, RawFd)> = Vec::new();
        {
            let mut q = shared.queue.lock().unwrap();
            while let Some(item) = q.pop_front() {
                batch.push(item);
            }
        }

        // (3) Submit an FSYNC/DATASYNC SQE per drained fsync.
        for (id, fd) in &batch {
            let e = opcode::Fsync::new(types::Fd(*fd))
                .flags(types::FsyncFlags::DATASYNC)
                .build()
                .user_data(*id);
            // SAFETY: the target fd is kept alive by the `Arc<File>` held in the
            // inflight slab (inserted by `fsync()` before enqueue) until this id's CQE.
            if unsafe { push(&mut ring, &e) }.is_err() {
                fatal(&shared);
                return;
            }
        }

        // (4) If we drained work this iteration, submit without blocking and loop to
        //     drain more (process-more-first). Only block on an empty drain.
        if !batch.is_empty() {
            if ring.submit().is_err() {
                fatal(&shared);
                return;
            }
            reap(&shared, &mut ring, &mut eventfd_armed);
            continue;
        }

        // (5) Empty drain: clear armed BEFORE the final re-check so a straggler
        //     enqueue reads `false` and writes the eventfd (lost-wakeup-free).
        shared.armed.store(false, Ordering::Release);
        if !shared.queue.lock().unwrap().is_empty() {
            continue; // a straggler arrived; loop to drain it
        }
        if ring.submit_and_wait(1).is_err() {
            fatal(&shared);
            return;
        }
        reap(&shared, &mut ring, &mut eventfd_armed);
    }
}

/// Push an SQE, submitting + retrying once if the SQ is full.
///
/// Returns `Err` if either the `submit()` to drain the full SQ fails or the retried
/// push still cannot find room. Callers must treat `Err` as fatal (drain + exit),
/// because a dropped fsync SQE means that id's CQE never arrives → its caller's
/// `fsync().await` hangs forever with the `Arc<File>` leaking in the slab. A dropped
/// eventfd Read SQE loses a wakeup.
///
/// SAFETY: every caller guarantees the SQE's referenced memory (eventfd buffer, or
/// the fsync target fd via the inflight slab's `Arc<File>`) outlives the submission.
unsafe fn push(ring: &mut IoUring, e: &io_uring::squeue::Entry) -> std::io::Result<()> {
    if ring.submission().push(e).is_err() {
        ring.submit()?;
        // After submit drained the SQ there is guaranteed room (RING_ENTRIES=4096
        // >> any single batch), but treat a still-full SQ as fatal rather than
        // silently dropping the entry.
        ring.submission()
            .push(e)
            .map_err(|_| std::io::Error::other("io_uring SQ still full after submit"))?;
    }
    Ok(())
}

/// Reap all ready CQEs: eventfd → re-arm; fsync id → send result on its oneshot and
/// drop the slab entry (releasing the `Arc<File>`).
fn reap(shared: &Arc<Shared>, ring: &mut IoUring, eventfd_armed: &mut bool) {
    // Collect first to avoid a double mutable borrow of `ring`.
    let cqes: Vec<(u64, i32)> = ring.completion().map(|c| (c.user_data(), c.result())).collect();
    for (ud, res) in cqes {
        if ud == UD_EVENTFD {
            *eventfd_armed = false; // consumed; re-arm next iteration
            continue;
        }
        // Each id maps to exactly one InFlight: removing it both routes the result
        // to the right caller and releases that fsync's `Arc<File>`.
        if let Some(entry) = shared.inflight.lock().unwrap().remove(&ud) {
            let result = if res < 0 {
                Err(std::io::Error::from_raw_os_error(-res))
            } else {
                Ok(())
            };
            // Receiver may have dropped (cancelled caller) — the send is then a
            // harmless no-op, but `entry` (incl. `Arc<File>`) still drops here →
            // fd released.
            let _ = entry.tx.send(result);
        }
    }
}

/// Fatal ring error: fail EVERY in-flight fsync so no caller's `fsync().await`
/// hangs, dropping each `Arc<File>` as the slab is drained, then exit the thread.
fn fatal(shared: &Arc<Shared>) {
    let mut map = shared.inflight.lock().unwrap();
    for (_, entry) in map.drain() {
        let _ = entry.tx.send(Err(std::io::Error::other(
            "strict io_uring fsync executor failed",
        )));
        // entry (incl. Arc<File>) dropped here → fd released
    }
    eprintln!("strict io_uring fsync executor: fatal ring error, thread exiting");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_succeeds_in_supported_env() {
        assert!(
            probe(),
            "io_uring should be available in the privileged test container"
        );
    }

    #[test]
    fn fsync_makes_writes_durable_and_returns_ok() {
        use std::io::Write;
        use std::sync::Arc;

        let dir = std::env::temp_dir().join(format!("ds-strict-uring-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("f.dat");
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .read(true)
            .open(&path)
            .unwrap();
        f.write_all(b"hello-strict-io-uring").unwrap();
        let file = Arc::new(f);

        let pool = start().unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(pool.fsync(Arc::clone(&file))).expect("fsync ok");

        let raw = std::fs::read(&path).unwrap();
        assert_eq!(&raw, b"hello-strict-io-uring", "bytes present after fsync");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Concurrency: many independent fsyncs in flight at once must each resolve to
    /// their OWN result with no cross-wiring (each id → exactly one oneshot).
    #[test]
    fn many_concurrent_fsyncs_each_resolve_ok() {
        use std::io::Write;
        use std::sync::Arc;

        let dir =
            std::env::temp_dir().join(format!("ds-strict-uring-many-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let pool = start().unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();

        const N: usize = 64;
        let mut files = Vec::new();
        for i in 0..N {
            let path = dir.join(format!("f{i}.dat"));
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .read(true)
                .open(&path)
                .unwrap();
            f.write_all(format!("payload-{i}").as_bytes()).unwrap();
            files.push(Arc::new(f));
        }

        rt.block_on(async {
            let mut futs = Vec::new();
            for f in &files {
                futs.push(pool.fsync(Arc::clone(f)));
            }
            for fut in futs {
                fut.await.expect("each concurrent fsync ok");
            }
        });

        for i in 0..N {
            let raw = std::fs::read(dir.join(format!("f{i}.dat"))).unwrap();
            assert_eq!(raw, format!("payload-{i}").into_bytes());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A real negative fsync CQE (EINVAL from fdatasync on a pipe read-end) must
    /// propagate `Err` through the oneshot to the `fsync().await` caller.
    /// This exercises the `res < 0` branch in `reap()`.
    #[test]
    fn fsync_on_bad_fd_returns_err() {
        use std::os::fd::FromRawFd;
        use std::sync::Arc;

        let pool = start().unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();

        // Create a pipe: fdatasync/IORING_OP_FSYNC on a pipe fd returns EINVAL
        // (a genuine negative CQE) — exactly what we need to drive the res<0 branch.
        let mut fds = [0 as libc::c_int; 2];
        let rc = unsafe { libc::pipe(fds.as_mut_ptr()) };
        assert_eq!(rc, 0, "pipe creation failed");

        // Wrap both ends in File so they are closed on drop (no leaks).
        // We fsync only the read end; the write end is just kept alive until after
        // the fsync completes so the pipe isn't in a broken state during the call.
        let read_file = unsafe { std::fs::File::from_raw_fd(fds[0]) };
        let _write_end = unsafe { std::fs::File::from_raw_fd(fds[1]) };

        let res = rt.block_on(pool.fsync(Arc::new(read_file)));
        assert!(
            res.is_err(),
            "fdatasync on a pipe fd must surface Err to the awaiter (real negative CQE)"
        );
    }
}
