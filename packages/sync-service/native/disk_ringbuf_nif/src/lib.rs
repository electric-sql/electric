//! Rustler NIF bindings for disk_ringbuf - IPC-safe disk-backed ring buffer.
//!
//! This NIF exposes the BoundedDiskRingBuffer to Elixir, enabling high-performance
//! disk-backed queues with backpressure and interprocess safety.

use rustler::{Binary, Encoder, Env, Error, NifResult, OwnedBinary, ResourceArc, Term};
use std::fs::OpenOptions;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use memmap2::MmapMut;

mod atoms {
    rustler::atoms! {
        ok,
        error,
        empty,
        full,
        timeout,
        closed,
    }
}

// ============================================================================
// Constants from disk_ringbuf
// ============================================================================

const MAGIC_BOUNDED: [u8; 8] = *b"DSKBND\0\0";
const VERSION: u32 = 2;
const HEADER_SIZE: usize = 64;
const RECORD_HEADER_SIZE: usize = 8;
const MIN_CAPACITY: u64 = 4096;
// Sentinel length value indicating "skip to start of buffer"
const WRAP_SENTINEL: u32 = 0xFFFFFFFF;

mod header_offsets {
    pub const MAGIC: usize = 0;
    pub const VERSION: usize = 8;
    pub const CAPACITY: usize = 16;
    pub const WRITE_POS: usize = 24;
    pub const READ_POS: usize = 32;
    pub const WRITE_SEQ: usize = 40;
    pub const READ_SEQ: usize = 48;
}

// ============================================================================
// Error type
// ============================================================================

#[derive(Debug)]
enum RingBufError {
    Io(io::Error),
    BadMagic,
    UnsupportedVersion(u32),
    CapacityTooSmall,
    RecordTooLarge { size: usize, max: usize },
    CorruptedRecord { pos: u64, reason: String },
    Empty,
    Full,
    Timeout,
    Closed,
}

impl From<io::Error> for RingBufError {
    fn from(e: io::Error) -> Self {
        RingBufError::Io(e)
    }
}

impl std::fmt::Display for RingBufError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RingBufError::Io(e) => write!(f, "I/O error: {}", e),
            RingBufError::BadMagic => write!(f, "Invalid file: bad magic number"),
            RingBufError::UnsupportedVersion(v) => write!(f, "Unsupported version: {}", v),
            RingBufError::CapacityTooSmall => {
                write!(f, "Buffer capacity too small (minimum {} bytes)", MIN_CAPACITY)
            }
            RingBufError::RecordTooLarge { size, max } => {
                write!(f, "Record too large: {} bytes (max {})", size, max)
            }
            RingBufError::CorruptedRecord { pos, reason } => {
                write!(f, "Corrupted record at position {}: {}", pos, reason)
            }
            RingBufError::Empty => write!(f, "Buffer is empty"),
            RingBufError::Full => write!(f, "Buffer is full"),
            RingBufError::Timeout => write!(f, "Operation timed out"),
            RingBufError::Closed => write!(f, "Buffer is closed"),
        }
    }
}

type Result<T> = std::result::Result<T, RingBufError>;

// ============================================================================
// Record Header
// ============================================================================

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct RecordHeader {
    length: u32,
    crc32: u32,
}

impl RecordHeader {
    fn as_bytes(&self) -> &[u8] {
        unsafe {
            std::slice::from_raw_parts(self as *const Self as *const u8, std::mem::size_of::<Self>())
        }
    }

    fn from_bytes(bytes: &[u8]) -> Self {
        assert!(bytes.len() >= std::mem::size_of::<Self>());
        unsafe { std::ptr::read(bytes.as_ptr() as *const Self) }
    }
}

// ============================================================================
// BoundedDiskRingBuffer - copied from disk_ringbuf for NIF use
// ============================================================================

pub struct BoundedDiskRingBuffer {
    mmap: MmapMut,
    capacity: u64,
    closed: AtomicBool,
}

// Safety: The atomics are stored in the mmap and accessed via atomic operations
unsafe impl Send for BoundedDiskRingBuffer {}
unsafe impl Sync for BoundedDiskRingBuffer {}

impl BoundedDiskRingBuffer {
    pub fn open<P: AsRef<Path>>(path: P, capacity: u64) -> Result<Self> {
        let path = path.as_ref();

        if path.exists() {
            Self::open_existing(path)
        } else {
            Self::create_new(path, capacity)
        }
    }

    fn create_new(path: &Path, capacity: u64) -> Result<Self> {
        if capacity < MIN_CAPACITY {
            return Err(RingBufError::CapacityTooSmall);
        }

        let total_size = HEADER_SIZE as u64 + capacity;

        // Create parent directories if needed
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)?;
            }
        }

        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)?;

        file.set_len(total_size)?;

        let mut mmap = unsafe { MmapMut::map_mut(&file)? };

        // Initialize header
        mmap[header_offsets::MAGIC..header_offsets::MAGIC + 8].copy_from_slice(&MAGIC_BOUNDED);
        mmap[header_offsets::VERSION..header_offsets::VERSION + 4]
            .copy_from_slice(&VERSION.to_ne_bytes());
        mmap[header_offsets::CAPACITY..header_offsets::CAPACITY + 8]
            .copy_from_slice(&capacity.to_ne_bytes());
        mmap[header_offsets::WRITE_POS..header_offsets::WRITE_POS + 8]
            .copy_from_slice(&0u64.to_ne_bytes());
        mmap[header_offsets::READ_POS..header_offsets::READ_POS + 8]
            .copy_from_slice(&0u64.to_ne_bytes());
        mmap[header_offsets::WRITE_SEQ..header_offsets::WRITE_SEQ + 8]
            .copy_from_slice(&0u64.to_ne_bytes());
        mmap[header_offsets::READ_SEQ..header_offsets::READ_SEQ + 8]
            .copy_from_slice(&0u64.to_ne_bytes());

        mmap.flush()?;

        Ok(Self {
            mmap,
            capacity,
            closed: AtomicBool::new(false),
        })
    }

    fn open_existing(path: &Path) -> Result<Self> {
        let file = OpenOptions::new().read(true).write(true).open(path)?;
        let mmap = unsafe { MmapMut::map_mut(&file)? };

        let mut magic = [0u8; 8];
        magic.copy_from_slice(&mmap[header_offsets::MAGIC..header_offsets::MAGIC + 8]);
        if magic != MAGIC_BOUNDED {
            return Err(RingBufError::BadMagic);
        }

        let version = u32::from_ne_bytes(
            mmap[header_offsets::VERSION..header_offsets::VERSION + 4]
                .try_into()
                .unwrap(),
        );
        if version != VERSION {
            return Err(RingBufError::UnsupportedVersion(version));
        }

        let capacity = u64::from_ne_bytes(
            mmap[header_offsets::CAPACITY..header_offsets::CAPACITY + 8]
                .try_into()
                .unwrap(),
        );

        Ok(Self {
            mmap,
            capacity,
            closed: AtomicBool::new(false),
        })
    }

    fn write_pos_atomic(&self) -> &AtomicU64 {
        unsafe { &*(self.mmap.as_ptr().add(header_offsets::WRITE_POS) as *const AtomicU64) }
    }

    fn read_pos_atomic(&self) -> &AtomicU64 {
        unsafe { &*(self.mmap.as_ptr().add(header_offsets::READ_POS) as *const AtomicU64) }
    }

    fn write_seq_atomic(&self) -> &AtomicU64 {
        unsafe { &*(self.mmap.as_ptr().add(header_offsets::WRITE_SEQ) as *const AtomicU64) }
    }

    fn read_seq_atomic(&self) -> &AtomicU64 {
        unsafe { &*(self.mmap.as_ptr().add(header_offsets::READ_SEQ) as *const AtomicU64) }
    }

    pub fn capacity(&self) -> u64 {
        self.capacity
    }

    pub fn max_record_size(&self) -> usize {
        (self.capacity as usize).saturating_sub(RECORD_HEADER_SIZE)
    }

    fn get_write_pos(&self) -> u64 {
        self.write_pos_atomic().load(Ordering::Acquire)
    }

    fn get_read_pos(&self) -> u64 {
        self.read_pos_atomic().load(Ordering::Acquire)
    }

    fn used_space(&self) -> u64 {
        let write_seq = self.write_seq_atomic().load(Ordering::Acquire);
        let read_seq = self.read_seq_atomic().load(Ordering::Acquire);
        let write_pos = self.get_write_pos();
        let read_pos = self.get_read_pos();

        if write_seq == read_seq {
            0
        } else if write_pos >= read_pos {
            write_pos - read_pos
        } else {
            self.capacity - read_pos + write_pos
        }
    }

    fn available_space(&self) -> u64 {
        self.capacity - self.used_space()
    }

    fn has_space_for(&self, record_size: usize) -> bool {
        self.available_space() >= record_size as u64
    }

    fn has_data(&self) -> bool {
        let write_seq = self.write_seq_atomic().load(Ordering::Acquire);
        let read_seq = self.read_seq_atomic().load(Ordering::Acquire);
        write_seq > read_seq
    }

    pub fn push(&self, data: &[u8]) -> Result<u64> {
        self.push_timeout(data, None)
    }

    pub fn push_timeout(&self, data: &[u8], timeout: Option<Duration>) -> Result<u64> {
        let record_size = Self::padded_record_size(data.len());

        if data.len() > self.max_record_size() {
            return Err(RingBufError::RecordTooLarge {
                size: data.len(),
                max: self.max_record_size(),
            });
        }

        let deadline = timeout.map(|t| Instant::now() + t);

        loop {
            if self.closed.load(Ordering::Relaxed) {
                return Err(RingBufError::Closed);
            }

            if self.has_space_for(record_size) {
                break;
            }

            if let Some(deadline) = deadline {
                if Instant::now() >= deadline {
                    return Err(RingBufError::Timeout);
                }
            }

            std::hint::spin_loop();
        }

        self.do_push(data, record_size)
    }

    pub fn try_push(&self, data: &[u8]) -> Result<u64> {
        let record_size = Self::padded_record_size(data.len());

        if data.len() > self.max_record_size() {
            return Err(RingBufError::RecordTooLarge {
                size: data.len(),
                max: self.max_record_size(),
            });
        }

        if self.closed.load(Ordering::Relaxed) {
            return Err(RingBufError::Closed);
        }

        if !self.has_space_for(record_size) {
            return Err(RingBufError::Full);
        }

        self.do_push(data, record_size)
    }

    fn do_push(&self, data: &[u8], record_size: usize) -> Result<u64> {
        let crc = crc32fast::hash(data);

        let write_pos = self.get_write_pos();

        let actual_write_pos = if write_pos + record_size as u64 > self.capacity {
            // Record doesn't fit at current position - need to wrap to start
            // Write a sentinel at current position to tell readers to skip to 0
            self.write_wrap_sentinel(write_pos)?;
            0
        } else {
            write_pos
        };

        self.write_record_at(actual_write_pos, data, crc)?;

        let new_pos = (actual_write_pos + record_size as u64) % self.capacity;
        self.write_pos_atomic().store(new_pos, Ordering::Release);

        let seq = self.write_seq_atomic().fetch_add(1, Ordering::Release);

        Ok(seq)
    }

    fn write_wrap_sentinel(&self, pos: u64) -> Result<()> {
        let header = RecordHeader {
            length: WRAP_SENTINEL,
            crc32: 0,
        };

        let data_start = HEADER_SIZE as u64;
        self.write_circular(pos, header.as_bytes(), data_start)?;
        Ok(())
    }

    pub fn pop(&self) -> Result<Vec<u8>> {
        self.pop_timeout(None)
    }

    pub fn pop_timeout(&self, timeout: Option<Duration>) -> Result<Vec<u8>> {
        let deadline = timeout.map(|t| Instant::now() + t);

        loop {
            if self.has_data() {
                break;
            }

            if self.closed.load(Ordering::Relaxed) {
                return Err(RingBufError::Closed);
            }

            if let Some(deadline) = deadline {
                if Instant::now() >= deadline {
                    return Err(RingBufError::Timeout);
                }
            }

            std::hint::spin_loop();
        }

        let read_pos = self.get_read_pos();
        let (data, new_pos) = self.read_record_at(read_pos)?;

        self.read_pos_atomic().store(new_pos, Ordering::Release);
        self.read_seq_atomic().fetch_add(1, Ordering::Release);

        Ok(data)
    }

    pub fn try_pop(&self) -> Result<Option<Vec<u8>>> {
        if !self.has_data() {
            return Ok(None);
        }

        let read_pos = self.get_read_pos();
        let (data, new_pos) = self.read_record_at(read_pos)?;

        self.read_pos_atomic().store(new_pos, Ordering::Release);
        self.read_seq_atomic().fetch_add(1, Ordering::Release);

        Ok(Some(data))
    }

    pub fn peek(&self) -> Result<Option<Vec<u8>>> {
        if !self.has_data() {
            return Ok(None);
        }

        let read_pos = self.get_read_pos();
        let (data, _new_pos) = self.read_record_at(read_pos)?;

        Ok(Some(data))
    }

    pub fn peek_n(&self, n: usize) -> Result<Vec<Vec<u8>>> {
        let mut results = Vec::with_capacity(n);
        let mut pos = self.get_read_pos();
        let pending = self.len() as usize;
        let to_read = std::cmp::min(n, pending);

        for _ in 0..to_read {
            match self.read_record_at(pos) {
                Ok((data, new_pos)) => {
                    results.push(data);
                    pos = new_pos;
                }
                Err(e) => return Err(e),
            }
        }

        Ok(results)
    }

    pub fn commit(&self) -> Result<()> {
        if !self.has_data() {
            return Err(RingBufError::Empty);
        }

        let read_pos = self.get_read_pos();
        let (_data, new_pos) = self.read_record_at(read_pos)?;

        self.read_pos_atomic().store(new_pos, Ordering::Release);
        self.read_seq_atomic().fetch_add(1, Ordering::Release);

        Ok(())
    }

    pub fn commit_n(&self, n: usize) -> Result<()> {
        let pending = self.len() as usize;
        if n > pending {
            return Err(RingBufError::Empty);
        }

        let mut pos = self.get_read_pos();

        for _ in 0..n {
            let (_data, new_pos) = self.read_record_at(pos)?;
            pos = new_pos;
        }

        self.read_pos_atomic().store(pos, Ordering::Release);
        self.read_seq_atomic().fetch_add(n as u64, Ordering::Release);

        Ok(())
    }

    pub fn close(&self) {
        self.closed.store(true, Ordering::Release);
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    pub fn is_empty(&self) -> bool {
        !self.has_data()
    }

    pub fn is_full(&self) -> bool {
        self.available_space() < (RECORD_HEADER_SIZE + 8) as u64
    }

    pub fn len(&self) -> u64 {
        let write_seq = self.write_seq_atomic().load(Ordering::Acquire);
        let read_seq = self.read_seq_atomic().load(Ordering::Acquire);
        write_seq.saturating_sub(read_seq)
    }

    pub fn flush(&self) -> Result<()> {
        self.mmap.flush()?;
        Ok(())
    }

    fn padded_record_size(data_len: usize) -> usize {
        let size = RECORD_HEADER_SIZE + data_len;
        (size + 7) & !7
    }

    fn write_record_at(&self, pos: u64, data: &[u8], crc: u32) -> Result<()> {
        let header = RecordHeader {
            length: data.len() as u32,
            crc32: crc,
        };

        let data_start = HEADER_SIZE as u64;
        self.write_circular(pos, header.as_bytes(), data_start)?;
        self.write_circular(pos + RECORD_HEADER_SIZE as u64, data, data_start)?;

        Ok(())
    }

    fn write_circular(&self, pos: u64, bytes: &[u8], data_start: u64) -> Result<()> {
        let pos_in_buffer = pos % self.capacity;
        let file_pos = data_start + pos_in_buffer;

        // Get mutable access via interior mutability pattern
        let mmap_ptr = self.mmap.as_ptr() as *mut u8;

        if pos_in_buffer + bytes.len() as u64 <= self.capacity {
            let start = file_pos as usize;
            unsafe {
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), mmap_ptr.add(start), bytes.len());
            }
        } else {
            let first_chunk_len = (self.capacity - pos_in_buffer) as usize;
            let first_start = file_pos as usize;

            unsafe {
                std::ptr::copy_nonoverlapping(
                    bytes.as_ptr(),
                    mmap_ptr.add(first_start),
                    first_chunk_len,
                );
            }

            let second_start = data_start as usize;
            unsafe {
                std::ptr::copy_nonoverlapping(
                    bytes.as_ptr().add(first_chunk_len),
                    mmap_ptr.add(second_start),
                    bytes.len() - first_chunk_len,
                );
            }
        }

        Ok(())
    }

    /// Read record at position. Returns (data, new_read_pos) where new_read_pos is the
    /// position after this record (accounting for any wrap sentinels).
    fn read_record_at(&self, pos: u64) -> Result<(Vec<u8>, u64)> {
        let data_start = HEADER_SIZE as u64;

        let mut header_bytes = [0u8; RECORD_HEADER_SIZE];
        self.read_circular(pos, &mut header_bytes, data_start)?;

        let header = RecordHeader::from_bytes(&header_bytes);

        // Check for wrap sentinel - if found, skip to position 0 and read from there
        if header.length == WRAP_SENTINEL {
            return self.read_record_at(0);
        }

        if header.length as usize > self.max_record_size() {
            return Err(RingBufError::CorruptedRecord {
                pos,
                reason: format!("invalid length: {}", header.length),
            });
        }

        let mut data = vec![0u8; header.length as usize];
        self.read_circular(pos + RECORD_HEADER_SIZE as u64, &mut data, data_start)?;

        let computed_crc = crc32fast::hash(&data);
        if computed_crc != header.crc32 {
            return Err(RingBufError::CorruptedRecord {
                pos,
                reason: format!(
                    "CRC mismatch: expected {:08x}, got {:08x}",
                    header.crc32, computed_crc
                ),
            });
        }

        let record_size = Self::padded_record_size(header.length as usize);
        let new_pos = (pos + record_size as u64) % self.capacity;
        Ok((data, new_pos))
    }

    fn read_circular(&self, pos: u64, buf: &mut [u8], data_start: u64) -> Result<()> {
        let pos_in_buffer = pos % self.capacity;
        let file_pos = data_start + pos_in_buffer;

        if pos_in_buffer + buf.len() as u64 <= self.capacity {
            let start = file_pos as usize;
            let end = start + buf.len();
            buf.copy_from_slice(&self.mmap[start..end]);
        } else {
            let first_chunk_len = (self.capacity - pos_in_buffer) as usize;
            let first_start = file_pos as usize;
            let first_end = first_start + first_chunk_len;

            buf[..first_chunk_len].copy_from_slice(&self.mmap[first_start..first_end]);

            let second_start = data_start as usize;
            let second_end = second_start + (buf.len() - first_chunk_len);

            buf[first_chunk_len..].copy_from_slice(&self.mmap[second_start..second_end]);
        }

        Ok(())
    }
}

// ============================================================================
// NIF Resource wrapper
// ============================================================================

pub struct RingBufResource {
    inner: BoundedDiskRingBuffer,
}

fn on_load(env: Env, _info: Term) -> bool {
    rustler::resource!(RingBufResource, env);
    true
}

// ============================================================================
// Helper to convert errors to NIF terms
// ============================================================================

fn error_to_term<'a>(env: Env<'a>, err: RingBufError) -> Term<'a> {
    match err {
        RingBufError::Empty => (atoms::error(), atoms::empty()).encode(env),
        RingBufError::Full => (atoms::error(), atoms::full()).encode(env),
        RingBufError::Timeout => (atoms::error(), atoms::timeout()).encode(env),
        RingBufError::Closed => (atoms::error(), atoms::closed()).encode(env),
        other => (atoms::error(), format!("{}", other)).encode(env),
    }
}

// ============================================================================
// NIF Functions
// ============================================================================

/// Open or create a bounded disk ring buffer.
#[rustler::nif(schedule = "DirtyIo")]
fn open<'a>(env: Env<'a>, path: String, capacity: u64) -> Term<'a> {
    match BoundedDiskRingBuffer::open(&path, capacity) {
        Ok(buf) => {
            let resource = ResourceArc::new(RingBufResource { inner: buf });
            (atoms::ok(), resource).encode(env)
        }
        Err(e) => error_to_term(env, e),
    }
}

/// Push data to the buffer, blocking if full.
#[rustler::nif(schedule = "DirtyCpu")]
fn push<'a>(env: Env<'a>, resource: ResourceArc<RingBufResource>, data: Binary) -> Term<'a> {
    match resource.inner.push(data.as_slice()) {
        Ok(seq) => (atoms::ok(), seq).encode(env),
        Err(e) => error_to_term(env, e),
    }
}

/// Push data with timeout (milliseconds).
#[rustler::nif(schedule = "DirtyCpu")]
fn push_timeout<'a>(
    env: Env<'a>,
    resource: ResourceArc<RingBufResource>,
    data: Binary,
    timeout_ms: u64,
) -> Term<'a> {
    let timeout = Duration::from_millis(timeout_ms);
    match resource.inner.push_timeout(data.as_slice(), Some(timeout)) {
        Ok(seq) => (atoms::ok(), seq).encode(env),
        Err(e) => error_to_term(env, e),
    }
}

/// Try to push data without blocking.
#[rustler::nif(schedule = "DirtyCpu")]
fn try_push<'a>(env: Env<'a>, resource: ResourceArc<RingBufResource>, data: Binary) -> Term<'a> {
    match resource.inner.try_push(data.as_slice()) {
        Ok(seq) => (atoms::ok(), seq).encode(env),
        Err(e) => error_to_term(env, e),
    }
}

/// Pop data from the buffer, blocking if empty.
#[rustler::nif(schedule = "DirtyCpu")]
fn pop<'a>(env: Env<'a>, resource: ResourceArc<RingBufResource>) -> Term<'a> {
    match resource.inner.pop() {
        Ok(data) => {
            let mut binary = match OwnedBinary::new(data.len()) {
                Some(b) => b,
                None => return (atoms::error(), "allocation_failed").encode(env),
            };
            binary.as_mut_slice().copy_from_slice(&data);
            (atoms::ok(), binary.release(env)).encode(env)
        }
        Err(e) => error_to_term(env, e),
    }
}

/// Pop data with timeout (milliseconds).
#[rustler::nif(schedule = "DirtyCpu")]
fn pop_timeout<'a>(
    env: Env<'a>,
    resource: ResourceArc<RingBufResource>,
    timeout_ms: u64,
) -> Term<'a> {
    let timeout = Duration::from_millis(timeout_ms);
    match resource.inner.pop_timeout(Some(timeout)) {
        Ok(data) => {
            let mut binary = match OwnedBinary::new(data.len()) {
                Some(b) => b,
                None => return (atoms::error(), "allocation_failed").encode(env),
            };
            binary.as_mut_slice().copy_from_slice(&data);
            (atoms::ok(), binary.release(env)).encode(env)
        }
        Err(e) => error_to_term(env, e),
    }
}

/// Try to pop data without blocking.
#[rustler::nif(schedule = "DirtyCpu")]
fn try_pop<'a>(env: Env<'a>, resource: ResourceArc<RingBufResource>) -> Term<'a> {
    match resource.inner.try_pop() {
        Ok(Some(data)) => {
            let mut binary = match OwnedBinary::new(data.len()) {
                Some(b) => b,
                None => return (atoms::error(), "allocation_failed").encode(env),
            };
            binary.as_mut_slice().copy_from_slice(&data);
            (atoms::ok(), binary.release(env)).encode(env)
        }
        Ok(None) => atoms::empty().encode(env),
        Err(e) => error_to_term(env, e),
    }
}

/// Peek at the next record without consuming it.
#[rustler::nif(schedule = "DirtyCpu")]
fn peek<'a>(env: Env<'a>, resource: ResourceArc<RingBufResource>) -> Term<'a> {
    match resource.inner.peek() {
        Ok(Some(data)) => {
            let mut binary = match OwnedBinary::new(data.len()) {
                Some(b) => b,
                None => return (atoms::error(), "allocation_failed").encode(env),
            };
            binary.as_mut_slice().copy_from_slice(&data);
            (atoms::ok(), binary.release(env)).encode(env)
        }
        Ok(None) => atoms::empty().encode(env),
        Err(e) => error_to_term(env, e),
    }
}

/// Peek at up to n records without consuming them.
#[rustler::nif(schedule = "DirtyCpu")]
fn peek_n<'a>(env: Env<'a>, resource: ResourceArc<RingBufResource>, n: usize) -> Term<'a> {
    match resource.inner.peek_n(n) {
        Ok(records) => {
            let binaries: Vec<Term<'a>> = records
                .into_iter()
                .filter_map(|data| {
                    let mut binary = OwnedBinary::new(data.len())?;
                    binary.as_mut_slice().copy_from_slice(&data);
                    Some(binary.release(env).encode(env))
                })
                .collect();
            (atoms::ok(), binaries).encode(env)
        }
        Err(e) => error_to_term(env, e),
    }
}

/// Commit (consume) the next record after peeking.
#[rustler::nif(schedule = "DirtyCpu")]
fn commit<'a>(env: Env<'a>, resource: ResourceArc<RingBufResource>) -> Term<'a> {
    match resource.inner.commit() {
        Ok(()) => atoms::ok().encode(env),
        Err(e) => error_to_term(env, e),
    }
}

/// Commit (consume) n records after peeking.
#[rustler::nif(schedule = "DirtyCpu")]
fn commit_n<'a>(env: Env<'a>, resource: ResourceArc<RingBufResource>, n: usize) -> Term<'a> {
    match resource.inner.commit_n(n) {
        Ok(()) => atoms::ok().encode(env),
        Err(e) => error_to_term(env, e),
    }
}

/// Get the number of pending records.
#[rustler::nif]
fn len(resource: ResourceArc<RingBufResource>) -> u64 {
    resource.inner.len()
}

/// Check if the buffer is empty.
#[rustler::nif]
fn is_empty(resource: ResourceArc<RingBufResource>) -> bool {
    resource.inner.is_empty()
}

/// Check if the buffer is full.
#[rustler::nif]
fn is_full(resource: ResourceArc<RingBufResource>) -> bool {
    resource.inner.is_full()
}

/// Get the buffer capacity in bytes.
#[rustler::nif]
fn capacity(resource: ResourceArc<RingBufResource>) -> u64 {
    resource.inner.capacity()
}

/// Get the maximum record size.
#[rustler::nif]
fn max_record_size(resource: ResourceArc<RingBufResource>) -> usize {
    resource.inner.max_record_size()
}

/// Close the buffer, causing pending operations to return errors.
#[rustler::nif]
fn close(resource: ResourceArc<RingBufResource>) -> rustler::Atom {
    resource.inner.close();
    atoms::ok()
}

/// Flush the buffer to disk.
#[rustler::nif(schedule = "DirtyIo")]
fn flush<'a>(env: Env<'a>, resource: ResourceArc<RingBufResource>) -> Term<'a> {
    match resource.inner.flush() {
        Ok(()) => atoms::ok().encode(env),
        Err(e) => error_to_term(env, e),
    }
}

rustler::init!(
    "Elixir.Electric.Nifs.DiskRingBuf",
    load = on_load
);
