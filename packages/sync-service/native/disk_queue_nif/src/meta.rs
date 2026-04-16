use crate::error::{QueueError, Result};
use memmap2::MmapMut;
use std::fs::OpenOptions;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

const META_SIZE: usize = 128;
const META_MAGIC: [u8; 8] = *b"DISKQ\0\0\0";
const META_VERSION: u32 = 1;

mod offsets {
    pub const MAGIC: usize = 0;
    pub const VERSION: usize = 8;
    pub const SEGMENT_SIZE: usize = 12;
    pub const WRITE_SEG: usize = 16;
    pub const WRITE_POS: usize = 24;
    pub const READ_SEG: usize = 32;
    pub const READ_POS: usize = 40;
    pub const COMMIT_SEG: usize = 48;
    pub const COMMIT_POS: usize = 56;
    pub const WRITE_SEQ: usize = 64;
    pub const READ_SEQ: usize = 72;
    pub const COMMIT_SEQ: usize = 80;
}

pub struct Meta {
    mmap: MmapMut,
}

impl Meta {
    pub fn open_or_create(path: &Path, default_segment_size: u32) -> Result<Self> {
        if path.exists() {
            Self::open_existing(path)
        } else {
            Self::create_new(path, default_segment_size)
        }
    }

    fn create_new(path: &Path, default_segment_size: u32) -> Result<Self> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)?;
        file.set_len(META_SIZE as u64)?;

        let mut mmap = unsafe { MmapMut::map_mut(&file)? };

        mmap[offsets::MAGIC..offsets::MAGIC + 8].copy_from_slice(&META_MAGIC);
        mmap[offsets::VERSION..offsets::VERSION + 4]
            .copy_from_slice(&META_VERSION.to_ne_bytes());
        mmap[offsets::SEGMENT_SIZE..offsets::SEGMENT_SIZE + 4]
            .copy_from_slice(&default_segment_size.to_ne_bytes());
        // All other fields are zero-initialized (segment 0, pos 0, seq 0)

        Ok(Self { mmap })
    }

    fn open_existing(path: &Path) -> Result<Self> {
        let file = OpenOptions::new().read(true).write(true).open(path)?;
        let mmap = unsafe { MmapMut::map_mut(&file)? };

        let mut magic = [0u8; 8];
        magic.copy_from_slice(&mmap[offsets::MAGIC..offsets::MAGIC + 8]);
        if magic != META_MAGIC {
            return Err(QueueError::BadMagic);
        }

        let version = u32::from_ne_bytes(
            mmap[offsets::VERSION..offsets::VERSION + 4]
                .try_into()
                .unwrap(),
        );
        if version != META_VERSION {
            return Err(QueueError::UnsupportedVersion(version));
        }

        Ok(Self { mmap })
    }

    fn atomic_u64(&self, offset: usize) -> &AtomicU64 {
        unsafe { &*(self.mmap.as_ptr().add(offset) as *const AtomicU64) }
    }

    pub fn segment_size(&self) -> u32 {
        u32::from_ne_bytes(
            self.mmap[offsets::SEGMENT_SIZE..offsets::SEGMENT_SIZE + 4]
                .try_into()
                .unwrap(),
        )
    }

    pub fn write_seg(&self) -> u64 {
        self.atomic_u64(offsets::WRITE_SEG).load(Ordering::Acquire)
    }
    pub fn set_write_seg(&self, val: u64) {
        self.atomic_u64(offsets::WRITE_SEG).store(val, Ordering::Release);
    }

    pub fn write_pos(&self) -> u64 {
        self.atomic_u64(offsets::WRITE_POS).load(Ordering::Acquire)
    }
    pub fn set_write_pos(&self, val: u64) {
        self.atomic_u64(offsets::WRITE_POS).store(val, Ordering::Release);
    }

    pub fn read_seg(&self) -> u64 {
        self.atomic_u64(offsets::READ_SEG).load(Ordering::Acquire)
    }
    pub fn set_read_seg(&self, val: u64) {
        self.atomic_u64(offsets::READ_SEG).store(val, Ordering::Release);
    }

    pub fn read_pos(&self) -> u64 {
        self.atomic_u64(offsets::READ_POS).load(Ordering::Acquire)
    }
    pub fn set_read_pos(&self, val: u64) {
        self.atomic_u64(offsets::READ_POS).store(val, Ordering::Release);
    }

    pub fn commit_seg(&self) -> u64 {
        self.atomic_u64(offsets::COMMIT_SEG).load(Ordering::Acquire)
    }
    pub fn set_commit_seg(&self, val: u64) {
        self.atomic_u64(offsets::COMMIT_SEG).store(val, Ordering::Release);
    }

    pub fn commit_pos(&self) -> u64 {
        self.atomic_u64(offsets::COMMIT_POS).load(Ordering::Acquire)
    }
    pub fn set_commit_pos(&self, val: u64) {
        self.atomic_u64(offsets::COMMIT_POS).store(val, Ordering::Release);
    }

    pub fn write_seq(&self) -> u64 {
        self.atomic_u64(offsets::WRITE_SEQ).load(Ordering::Acquire)
    }
    pub fn set_write_seq(&self, val: u64) {
        self.atomic_u64(offsets::WRITE_SEQ).store(val, Ordering::Release);
    }
    pub fn inc_write_seq(&self) -> u64 {
        self.atomic_u64(offsets::WRITE_SEQ).fetch_add(1, Ordering::Release)
    }

    pub fn read_seq(&self) -> u64 {
        self.atomic_u64(offsets::READ_SEQ).load(Ordering::Acquire)
    }
    pub fn set_read_seq(&self, val: u64) {
        self.atomic_u64(offsets::READ_SEQ).store(val, Ordering::Release);
    }
    pub fn inc_read_seq(&self) -> u64 {
        self.atomic_u64(offsets::READ_SEQ).fetch_add(1, Ordering::Release)
    }

    pub fn commit_seq(&self) -> u64 {
        self.atomic_u64(offsets::COMMIT_SEQ).load(Ordering::Acquire)
    }
    pub fn set_commit_seq(&self, val: u64) {
        self.atomic_u64(offsets::COMMIT_SEQ).store(val, Ordering::Release);
    }
}
