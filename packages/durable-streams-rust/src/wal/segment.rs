//! WAL segment files — `fallocate`'d, append-only, positioned writes + `fdatasync`.
//!
//! A shard's durable log is a sequence of fixed-size segment files
//! `<shard_dir>/<start_lsn>.wal`, each [`fallocate`'d](FileSegment::create) to
//! its full [`SEGMENT_BYTES`] up front. Because every append lands in
//! already-allocated space (no inode-size change), a plain `fdatasync` is
//! sufficient to make a write durable — no `fsync` of the file metadata is
//! needed (design spec §4).
//!
//! [`SegmentWriter`] is the **io_uring drop-in seam** (design spec §3): the
//! committer's payload writes *and* its fsync go through this trait, so an
//! io_uring-backed implementation can replace [`FileSegment`] later without
//! touching the committer. It is deliberately minimal — positioned write +
//! `fdatasync`.

use std::io;
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};

/// Size each WAL segment is `fallocate`'d to (128 MiB). New records append into
/// this pre-allocated space until it fills, then a new segment is opened.
pub const SEGMENT_BYTES: u64 = 128 * 1024 * 1024;

/// Path of the segment whose first record has LSN `start_lsn`:
/// `<shard_dir>/<start_lsn>.wal`.
pub fn seg_path(shard_dir: &Path, start_lsn: u64) -> PathBuf {
    shard_dir.join(format!("{start_lsn}.wal"))
}

/// Abstraction over a shard's WAL segment I/O — the **io_uring drop-in seam**.
///
/// The default [`FileSegment`] impl uses ordinary positioned syscalls; an
/// io_uring impl is a drop-in later. The committer's `fdatasync` goes through
/// this trait too, so the swap is total.
pub trait SegmentWriter: Send + Sync {
    /// Write `bytes` at byte offset `off` (positioned; does not move a file
    /// cursor, so concurrent appenders may write disjoint offsets without
    /// racing on a shared seek position).
    fn write_at(&self, off: u64, bytes: &[u8]) -> io::Result<()>;

    /// Force all of this segment's dirty pages to stable storage. Because the
    /// file is `fallocate`'d, no metadata flush is required — `fdatasync`
    /// suffices (spec §4).
    fn fdatasync(&self) -> io::Result<()>;
}

/// A WAL segment backed by an ordinary file, `fallocate`'d to full size.
pub struct FileSegment {
    file: std::fs::File,
}

impl FileSegment {
    /// Create (or truncate) the segment at `path`, opening it `O_RDWR|O_CREAT`
    /// and pre-allocating `size` bytes so all appends land in-place.
    ///
    /// On Linux this is `fallocate`; on macOS (no `fallocate`) it falls back to
    /// `set_len` (`ftruncate`), which zero-fills the range and is sufficient for
    /// the test/dev path — production io_uring/`fallocate` is Linux-only anyway.
    pub fn create(path: PathBuf, size: u64) -> io::Result<Self> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)?;

        let fd = file.as_raw_fd();
        #[cfg(target_os = "linux")]
        // SAFETY: `fd` is a valid open fd for the lifetime of `file`; mode 0,
        // offset 0, len `size` allocate the whole range.
        unsafe {
            if libc::fallocate(fd, 0, 0, size as libc::off_t) != 0 {
                return Err(io::Error::last_os_error());
            }
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = fd;
            // No fallocate on macOS — ftruncate to the full size. This grows the
            // (sparse) file to `size`; writes within it are in-place.
            file.set_len(size)?;
        }

        Ok(FileSegment { file })
    }

    /// Open an EXISTING segment without changing its size or contents.
    ///
    /// Boot-time (`Shard::open`) must be non-destructive: a sealed segment is
    /// exactly packed (its length IS the durable-log seam recovery walks across),
    /// so re-preallocating it to full size would graft a zero tail onto it and
    /// recovery would mis-read that tail as the end of the durable log — dropping
    /// every later segment's acked records. This constructor only opens the fd.
    pub fn open_existing(path: PathBuf) -> io::Result<Self> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .truncate(false)
            .open(&path)?;
        Ok(FileSegment { file })
    }

    /// **Seal** this segment at a roll: truncate it to exactly `len` bytes (drop
    /// the unused `fallocate`'d zero tail) and `fdatasync` so its new size + data
    /// are durable. After this the segment is **exactly packed** — its on-disk
    /// length equals the byte offset of the end of its last record, which is what
    /// lets recovery's `off == raw.len()` → next-segment logic walk across the
    /// seam without seeing a zero gap (spec §4, recovery.rs). Because `set_len`
    /// changes the inode size, we `fsync` (not just `fdatasync`) so the metadata
    /// size change is itself durable — a torn size would re-expose the zero tail.
    pub fn seal_to(&self, len: u64) -> io::Result<()> {
        self.file.set_len(len)?;
        let fd = self.file.as_raw_fd();
        // The truncate changes file SIZE (metadata), so a plain fdatasync may not
        // persist it — use a full fsync (macOS F_FULLFSYNC, Linux fsync).
        #[cfg(target_os = "macos")]
        {
            macos_full_fsync(fd)
        }
        #[cfg(not(target_os = "macos"))]
        // SAFETY: `fd` is a valid open fd for the lifetime of `self.file`.
        unsafe {
            if libc::fsync(fd) == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        }
    }
}

/// macOS F_FULLFSYNC with a plain-`fsync` fallback. On double failure the error
/// preserves the ORIGINAL F_FULLFSYNC errno in context — the fallback's errno
/// alone would mislead durability diagnostics. (Shared by `seal_to` and
/// `FileSegment::fdatasync`; mirrors `store::barrier_fsync`.)
/// BENCH-ONLY: whether `DS_BENCH_FAST_FSYNC` requests plain `fsync` over
/// `F_FULLFSYNC` on macOS. Read once and cached. Mirrors the gate in
/// `store::barrier_fsync`.
#[cfg(target_os = "macos")]
fn fast_fsync_enabled() -> bool {
    use std::sync::OnceLock;
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("DS_BENCH_FAST_FSYNC").is_some())
}

#[cfg(target_os = "macos")]
fn macos_full_fsync(fd: libc::c_int) -> io::Result<()> {
    // BENCH-ONLY (`DS_BENCH_FAST_FSYNC`): plain `fsync` instead of the
    // `F_FULLFSYNC` drive barrier so the committer's hot fsync is cheap on a RAM
    // disk and the per-shard LOCK becomes the bottleneck (the Linux+NVMe regime
    // this build studies). NOT power-loss durable; never set in production. See
    // `store::barrier_fsync` for the rationale.
    if fast_fsync_enabled() {
        // SAFETY: `fd` is a valid open fd for the lifetime of the call.
        return unsafe {
            if libc::fsync(fd) == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        };
    }
    // SAFETY: callers pass a valid open fd for the lifetime of the call.
    unsafe {
        if libc::fcntl(fd, libc::F_FULLFSYNC) == 0 {
            return Ok(());
        }
        let fullfsync_err = io::Error::last_os_error();
        if libc::fsync(fd) == 0 {
            return Ok(());
        }
        Err(io::Error::other(format!(
            "F_FULLFSYNC failed ({fullfsync_err}); fallback fsync also failed ({})",
            io::Error::last_os_error()
        )))
    }
}

impl SegmentWriter for FileSegment {
    fn write_at(&self, off: u64, bytes: &[u8]) -> io::Result<()> {
        let fd = self.file.as_raw_fd();
        let mut written: usize = 0;
        // pwrite may return a short count; loop until the whole slice lands.
        while written < bytes.len() {
            let buf = &bytes[written..];
            // SAFETY: `fd` is valid; `buf.as_ptr()`/`buf.len()` describe a live
            // slice; the kernel writes at the explicit offset (no cursor use).
            let n = unsafe {
                libc::pwrite(
                    fd,
                    buf.as_ptr() as *const libc::c_void,
                    buf.len(),
                    (off + written as u64) as libc::off_t,
                )
            };
            if n < 0 {
                return Err(io::Error::last_os_error());
            }
            if n == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "pwrite returned 0",
                ));
            }
            written += n as usize;
        }
        Ok(())
    }

    fn fdatasync(&self) -> io::Result<()> {
        let fd = self.file.as_raw_fd();
        // Mirror `store::barrier_fsync`: macOS has no fdatasync, so use
        // F_FULLFSYNC for a true flush-to-platter (power-loss durable); Linux
        // uses fdatasync.
        #[cfg(target_os = "macos")]
        {
            macos_full_fsync(fd)
        }
        #[cfg(not(target_os = "macos"))]
        // SAFETY: `fd` is a valid open fd for the lifetime of `self.file`.
        unsafe {
            if libc::fdatasync(fd) == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let p = std::env::temp_dir().join(format!(
            "ds-wal-seg-test-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[tokio::test]
    async fn segment_write_at_and_fdatasync() {
        let dir = tmp("seg");
        std::fs::create_dir_all(&dir).unwrap();
        let s = FileSegment::create(seg_path(&dir, 0), 1 << 20).unwrap();
        s.write_at(0, b"abc").unwrap();
        s.write_at(64, b"xyz").unwrap(); // disjoint offsets (concurrent-appender model)
        s.fdatasync().unwrap();
        let raw = std::fs::read(seg_path(&dir, 0)).unwrap();
        assert_eq!(raw.len() as u64, 1 << 20, "fallocate'd to full size");
        assert_eq!(&raw[0..3], b"abc");
        assert_eq!(&raw[64..67], b"xyz");
    }
}
