//! io_uring-backed file I/O for the write paths (`--io-uring on`, default off).
//!
//! Scope: the two hot write sites share this module —
//!   * WAL segment I/O (`wal/segment.rs` `SegmentWriter`): appender-side
//!     positioned record writes + the committer's group-commit `fdatasync`.
//!   * Stream data-file appends (`handlers::write_wire`), which BOTH durability
//!     modes execute on every append (memory mode's entire persistence path).
//!
//! Design: one **thread-local ring** per OS thread (rings are not `Sync`; the
//! committer is a dedicated thread and tokio workers each get their own), plain
//! submit-and-wait per op. That converts `pwrite`/`write`/`fdatasync` syscalls
//! into `io_uring_enter` round-trips — roughly syscall-neutral per op, but it
//! keeps the door open for linked WRITE→FSYNC chains and SQPOLL without touching
//! call sites again, and measures the uring path end-to-end.
//!
//! Fallback ladder (always correct, never fails closed):
//!   * flag off (default) → caller uses its normal syscalls.
//!   * non-Linux → flag is accepted but this module reports `enabled() == false`.
//!   * Linux without io_uring (kernel/seccomp) → one-time probe fails →
//!     `enabled() == false`, callers fall back to syscalls.

use std::sync::atomic::{AtomicBool, Ordering};

static REQUESTED: AtomicBool = AtomicBool::new(false);

pub fn set_requested(on: bool) {
    REQUESTED.store(on, Ordering::Relaxed);
}

/// True iff `--io-uring on` AND the platform actually supports it (probed once).
#[inline]
pub fn enabled() -> bool {
    REQUESTED.load(Ordering::Relaxed) && probe_ok()
}

#[cfg(target_os = "linux")]
fn probe_ok() -> bool {
    use std::sync::OnceLock;
    static OK: OnceLock<bool> = OnceLock::new();
    *OK.get_or_init(|| match io_uring::IoUring::new(8) {
        Ok(_) => true,
        Err(e) => {
            eprintln!("io_uring unavailable ({e}); --io-uring falling back to syscalls");
            false
        }
    })
}
#[cfg(not(target_os = "linux"))]
fn probe_ok() -> bool {
    false
}

#[cfg(target_os = "linux")]
mod linux {
    use std::cell::RefCell;
    use std::io;
    use std::os::fd::RawFd;

    use io_uring::{opcode, types, IoUring};

    // Ring depth 64: a single synchronous op per call needs 1, but leaves room
    // for future linked chains/batches on the same ring.
    thread_local! {
        static RING: RefCell<Option<IoUring>> = const { RefCell::new(None) };
    }

    fn with_ring<T>(f: impl FnOnce(&mut IoUring) -> io::Result<T>) -> io::Result<T> {
        RING.with(|r| {
            let mut r = r.borrow_mut();
            if r.is_none() {
                *r = Some(IoUring::new(64)?);
            }
            f(r.as_mut().unwrap())
        })
    }

    /// Submit one SQE and wait for its CQE, returning the raw kernel result.
    fn submit_one(ring: &mut IoUring, sqe: io_uring::squeue::Entry) -> io::Result<i32> {
        // SAFETY: the buffers referenced by `sqe` outlive the synchronous wait
        // below (callers pass slices that live across this call).
        unsafe {
            ring.submission()
                .push(&sqe)
                .map_err(|_| io::Error::other("io_uring SQ full"))?;
        }
        ring.submit_and_wait(1)?;
        let cqe = ring
            .completion()
            .next()
            .ok_or_else(|| io::Error::other("io_uring missing CQE"))?;
        Ok(cqe.result())
    }

    /// Positioned write of the whole slice (loops on short writes).
    pub fn pwrite_all(fd: RawFd, mut off: u64, mut buf: &[u8]) -> io::Result<()> {
        while !buf.is_empty() {
            let n = with_ring(|ring| {
                let sqe = opcode::Write::new(types::Fd(fd), buf.as_ptr(), buf.len() as u32)
                    .offset(off)
                    .build();
                submit_one(ring, sqe)
            })?;
            if n < 0 {
                return Err(io::Error::from_raw_os_error(-n));
            }
            if n == 0 {
                return Err(io::Error::new(io::ErrorKind::WriteZero, "uring write returned 0"));
            }
            off += n as u64;
            buf = &buf[n as usize..];
        }
        Ok(())
    }

    /// Append the whole slice to an `O_APPEND` fd (offset −1 = use file
    /// position; io_uring honours `O_APPEND` semantics).
    pub fn append_all(fd: RawFd, mut buf: &[u8]) -> io::Result<()> {
        while !buf.is_empty() {
            let n = with_ring(|ring| {
                let sqe = opcode::Write::new(types::Fd(fd), buf.as_ptr(), buf.len() as u32)
                    .offset(u64::MAX) // -1: append/current position
                    .build();
                submit_one(ring, sqe)
            })?;
            if n < 0 {
                return Err(io::Error::from_raw_os_error(-n));
            }
            if n == 0 {
                return Err(io::Error::new(io::ErrorKind::WriteZero, "uring write returned 0"));
            }
            buf = &buf[n as usize..];
        }
        Ok(())
    }

    /// `fdatasync` via io_uring (`IORING_FSYNC_DATASYNC`).
    pub fn fdatasync(fd: RawFd) -> io::Result<()> {
        let n = with_ring(|ring| {
            let sqe = opcode::Fsync::new(types::Fd(fd))
                .flags(types::FsyncFlags::DATASYNC)
                .build();
            submit_one(ring, sqe)
        })?;
        if n < 0 {
            return Err(io::Error::from_raw_os_error(-n));
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
pub use linux::{append_all, fdatasync, pwrite_all};

// Non-Linux stubs: never called (enabled() is false), exist so the crate compiles.
#[cfg(not(target_os = "linux"))]
#[allow(dead_code)]
pub fn pwrite_all(_fd: i32, _off: u64, _buf: &[u8]) -> std::io::Result<()> {
    unreachable!("io_uring path is Linux-only and gated by enabled()")
}
#[cfg(not(target_os = "linux"))]
#[allow(dead_code)]
pub fn append_all(_fd: i32, _buf: &[u8]) -> std::io::Result<()> {
    unreachable!("io_uring path is Linux-only and gated by enabled()")
}
#[cfg(not(target_os = "linux"))]
#[allow(dead_code)]
pub fn fdatasync(_fd: i32) -> std::io::Result<()> {
    unreachable!("io_uring path is Linux-only and gated by enabled()")
}
