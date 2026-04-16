use crate::error::{QueueError, Result};
use crate::record::{padded_record_size, RecordHeader, RECORD_HEADER_SIZE, RECORD_MAGIC};
use memmap2::MmapMut;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};

const SEG_HEADER_SIZE: usize = 64;
const SEG_MAGIC: [u8; 8] = *b"DSEG\0\0\0\0";
const SEG_VERSION: u32 = 1;

mod seg_offsets {
    pub const MAGIC: usize = 0;
    pub const VERSION: usize = 8;
    pub const SEGMENT_ID: usize = 16;
    pub const CAPACITY: usize = 24;
}

pub struct Segment {
    mmap: MmapMut,
    pub segment_id: u64,
    pub capacity: u64,
}

impl Segment {
    /// Format segment filename: seg_00000000000000XX.dat
    pub fn filename(segment_id: u64) -> String {
        format!("seg_{:016}.dat", segment_id)
    }

    pub fn path(dir: &Path, segment_id: u64) -> PathBuf {
        dir.join(Self::filename(segment_id))
    }

    /// Create a new segment file with the given capacity (data area size).
    pub fn create(dir: &Path, segment_id: u64, capacity: u64) -> Result<Self> {
        let path = Self::path(dir, segment_id);
        let total_size = SEG_HEADER_SIZE as u64 + capacity;

        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path)?;
        file.set_len(total_size)?;

        let mut mmap = unsafe { MmapMut::map_mut(&file)? };

        mmap[seg_offsets::MAGIC..seg_offsets::MAGIC + 8].copy_from_slice(&SEG_MAGIC);
        mmap[seg_offsets::VERSION..seg_offsets::VERSION + 4]
            .copy_from_slice(&SEG_VERSION.to_ne_bytes());
        mmap[seg_offsets::SEGMENT_ID..seg_offsets::SEGMENT_ID + 8]
            .copy_from_slice(&segment_id.to_ne_bytes());
        mmap[seg_offsets::CAPACITY..seg_offsets::CAPACITY + 8]
            .copy_from_slice(&capacity.to_ne_bytes());

        Ok(Self {
            mmap,
            segment_id,
            capacity,
        })
    }

    /// Open an existing segment file.
    pub fn open(dir: &Path, segment_id: u64) -> Result<Self> {
        let path = Self::path(dir, segment_id);
        let file = OpenOptions::new().read(true).write(true).open(&path)?;
        let mmap = unsafe { MmapMut::map_mut(&file)? };

        let mut magic = [0u8; 8];
        magic.copy_from_slice(&mmap[seg_offsets::MAGIC..seg_offsets::MAGIC + 8]);
        if magic != SEG_MAGIC {
            return Err(QueueError::BadMagic);
        }

        let version = u32::from_ne_bytes(
            mmap[seg_offsets::VERSION..seg_offsets::VERSION + 4]
                .try_into()
                .unwrap(),
        );
        if version != SEG_VERSION {
            return Err(QueueError::UnsupportedVersion(version));
        }

        let id = u64::from_ne_bytes(
            mmap[seg_offsets::SEGMENT_ID..seg_offsets::SEGMENT_ID + 8]
                .try_into()
                .unwrap(),
        );

        let capacity = u64::from_ne_bytes(
            mmap[seg_offsets::CAPACITY..seg_offsets::CAPACITY + 8]
                .try_into()
                .unwrap(),
        );

        Ok(Self {
            mmap,
            segment_id: id,
            capacity,
        })
    }

    /// Delete a segment file from disk.
    pub fn delete(dir: &Path, segment_id: u64) -> Result<()> {
        let path = Self::path(dir, segment_id);
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        Ok(())
    }

    /// Remaining space in this segment's data area.
    pub fn remaining(&self, write_pos: u64) -> u64 {
        self.capacity.saturating_sub(write_pos)
    }

    /// Can a record of this data length fit at the given write position?
    pub fn fits(&self, write_pos: u64, data_len: usize) -> bool {
        let record_size = padded_record_size(data_len) as u64;
        write_pos + record_size <= self.capacity
    }

    /// Write a record at the given position within the data area.
    /// Returns the number of bytes written (padded record size).
    pub fn write_record(&mut self, pos: u64, data: &[u8]) -> usize {
        let header = RecordHeader::new(data);
        let file_pos = SEG_HEADER_SIZE as u64 + pos;
        let record_size = padded_record_size(data.len());

        let offset = file_pos as usize;
        self.mmap[offset..offset + RECORD_HEADER_SIZE].copy_from_slice(header.as_bytes());
        self.mmap[offset + RECORD_HEADER_SIZE..offset + RECORD_HEADER_SIZE + data.len()]
            .copy_from_slice(data);

        record_size
    }

    /// Read a record at the given position within the data area.
    /// Returns the data and the position after this record.
    pub fn read_record(&self, pos: u64) -> Result<(Vec<u8>, u64)> {
        let file_pos = (SEG_HEADER_SIZE as u64 + pos) as usize;

        if pos + RECORD_HEADER_SIZE as u64 > self.capacity {
            return Err(QueueError::CorruptedRecord {
                seg_id: self.segment_id,
                offset: pos,
                reason: "record header extends past segment".into(),
            });
        }

        let header =
            RecordHeader::from_bytes(&self.mmap[file_pos..file_pos + RECORD_HEADER_SIZE]);

        if !header.is_valid() {
            return Err(QueueError::CorruptedRecord {
                seg_id: self.segment_id,
                offset: pos,
                reason: format!(
                    "invalid record magic: expected {:08x}, got {:08x}",
                    RECORD_MAGIC, header.magic
                ),
            });
        }

        let data_end = pos + RECORD_HEADER_SIZE as u64 + header.length as u64;
        if data_end > self.capacity {
            return Err(QueueError::CorruptedRecord {
                seg_id: self.segment_id,
                offset: pos,
                reason: format!("record data extends past segment (length: {})", header.length),
            });
        }

        let data_start = file_pos + RECORD_HEADER_SIZE;
        let data = self.mmap[data_start..data_start + header.length as usize].to_vec();

        let computed_crc = crc32fast::hash(&data);
        if computed_crc != header.crc32 {
            return Err(QueueError::CorruptedRecord {
                seg_id: self.segment_id,
                offset: pos,
                reason: format!(
                    "CRC mismatch: expected {:08x}, got {:08x}",
                    header.crc32, computed_crc
                ),
            });
        }

        let record_size = padded_record_size(header.length as usize);
        Ok((data, pos + record_size as u64))
    }

    /// Check if there's a valid record at the given position.
    /// Used for end-of-segment detection: returns false if we can't
    /// fit a record header or the magic marker is absent (unwritten space).
    pub fn has_record_at(&self, pos: u64) -> bool {
        if pos + RECORD_HEADER_SIZE as u64 > self.capacity {
            return false;
        }
        let file_pos = (SEG_HEADER_SIZE as u64 + pos) as usize;
        let header =
            RecordHeader::from_bytes(&self.mmap[file_pos..file_pos + RECORD_HEADER_SIZE]);
        header.is_valid()
    }
}
