use crate::error::{QueueError, Result};
use crate::meta::Meta;
use crate::record::padded_record_size;
use crate::segment::Segment;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub struct DiskQueue {
    dir: PathBuf,
    default_segment_size: u64,
    write_segment: Option<Segment>,
    read_segment: Option<Segment>,
    meta: Meta,
    closed: AtomicBool,
}

unsafe impl Send for DiskQueue {}
unsafe impl Sync for DiskQueue {}

impl DiskQueue {
    pub fn open<P: AsRef<Path>>(path: P, segment_size: Option<u32>) -> Result<Self> {
        let dir = path.as_ref().to_path_buf();
        let default_segment_size = segment_size.unwrap_or(8 * 1024 * 1024); // 8MB

        if !dir.exists() {
            std::fs::create_dir_all(&dir)?;
        }

        let meta_path = dir.join("meta.dat");
        let meta = Meta::open_or_create(&meta_path, default_segment_size)?;

        let mut queue = Self {
            dir,
            default_segment_size: meta.segment_size() as u64,
            write_segment: None,
            read_segment: None,
            meta,
            closed: AtomicBool::new(false),
        };

        queue.recover()?;

        Ok(queue)
    }

    fn recover(&mut self) -> Result<()> {
        // Reset read cursor to committed position
        let commit_seg = self.meta.commit_seg();
        let commit_pos = self.meta.commit_pos();
        let commit_seq = self.meta.commit_seq();
        self.meta.set_read_seg(commit_seg);
        self.meta.set_read_pos(commit_pos);
        self.meta.set_read_seq(commit_seq);

        let write_seg_id = self.meta.write_seg();

        // Delete orphaned segments: anything > write_seg
        self.cleanup_segments_above(write_seg_id)?;

        // Delete already-consumed segments: anything < commit_seg
        self.cleanup_segments_below(commit_seg)?;

        // Open write segment and validate records to find true write head
        let seg_path = Segment::path(&self.dir, write_seg_id);
        if seg_path.exists() {
            let seg = Segment::open(&self.dir, write_seg_id)?;

            // Scan forward validating CRC to find last good record
            let mut pos = 0u64;
            let mut valid_count = 0u64;

            // Count valid records across all segments from commit to write head
            // First count records in segments between commit_seg and write_seg
            for seg_id in commit_seg..write_seg_id {
                let scan_seg_path = Segment::path(&self.dir, seg_id);
                if scan_seg_path.exists() {
                    let scan_seg = Segment::open(&self.dir, seg_id)?;
                    let mut scan_pos = if seg_id == commit_seg { commit_pos } else { 0 };
                    while scan_seg.has_record_at(scan_pos) {
                        match scan_seg.read_record(scan_pos) {
                            Ok((_, next_pos)) => {
                                valid_count += 1;
                                scan_pos = next_pos;
                            }
                            Err(_) => break,
                        }
                    }
                }
            }

            // Now scan the write segment itself
            let start_pos = if write_seg_id == commit_seg { commit_pos } else { 0 };
            pos = start_pos;
            while seg.has_record_at(pos) {
                match seg.read_record(pos) {
                    Ok((_, next_pos)) => {
                        valid_count += 1;
                        pos = next_pos;
                    }
                    Err(_) => break,
                }
            }

            self.meta.set_write_pos(pos);
            self.meta.set_write_seq(commit_seq + valid_count);
            self.write_segment = Some(seg);
        } else {
            // No write segment exists — create one
            let seg = Segment::create(&self.dir, write_seg_id, self.default_segment_size)?;
            self.meta.set_write_pos(0);
            self.write_segment = Some(seg);
        }

        Ok(())
    }

    fn cleanup_segments_above(&self, max_id: u64) -> Result<()> {
        for entry in std::fs::read_dir(&self.dir)? {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if let Some(id) = Self::parse_segment_filename(&name) {
                if id > max_id {
                    std::fs::remove_file(entry.path())?;
                }
            }
        }
        Ok(())
    }

    fn cleanup_segments_below(&self, min_id: u64) -> Result<()> {
        for entry in std::fs::read_dir(&self.dir)? {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if let Some(id) = Self::parse_segment_filename(&name) {
                if id < min_id {
                    std::fs::remove_file(entry.path())?;
                }
            }
        }
        Ok(())
    }

    fn parse_segment_filename(name: &str) -> Option<u64> {
        let name = name.strip_prefix("seg_")?;
        let name = name.strip_suffix(".dat")?;
        name.parse().ok()
    }

    fn ensure_write_segment(&mut self, data_len: usize) -> Result<()> {
        let record_size = padded_record_size(data_len) as u64;

        if let Some(ref seg) = self.write_segment {
            if seg.remaining(self.meta.write_pos()) >= record_size {
                return Ok(());
            }
        }

        // Rotate: create new segment
        let new_seg_id = self.meta.write_seg() + 1;
        let capacity = std::cmp::max(self.default_segment_size, record_size);
        let seg = Segment::create(&self.dir, new_seg_id, capacity)?;

        self.write_segment = Some(seg);
        self.meta.set_write_seg(new_seg_id);
        self.meta.set_write_pos(0);

        Ok(())
    }

    fn ensure_read_segment(&mut self) -> Result<bool> {
        loop {
            let read_seg_id = self.meta.read_seg();

            // If we already have the right segment mmap'd, check if we need to advance
            let needs_open = match self.read_segment {
                Some(ref seg) if seg.segment_id == read_seg_id => {
                    let read_pos = self.meta.read_pos();
                    if seg.has_record_at(read_pos) {
                        return Ok(true);
                    }
                    // No more records in this segment — try advancing
                    let next_seg_id = read_seg_id + 1;
                    let next_path = Segment::path(&self.dir, next_seg_id);
                    if next_path.exists() {
                        self.read_segment = Some(Segment::open(&self.dir, next_seg_id)?);
                        self.meta.set_read_seg(next_seg_id);
                        self.meta.set_read_pos(0);
                        // Loop to check if the new segment has records
                        continue;
                    }
                    return Ok(false);
                }
                _ => true,
            };

            if needs_open {
                // Open the correct segment
                let seg_path = Segment::path(&self.dir, read_seg_id);
                if seg_path.exists() {
                    self.read_segment = Some(Segment::open(&self.dir, read_seg_id)?);
                    // Loop to check if this segment has records at the current read pos
                    continue;
                } else {
                    return Ok(false);
                }
            }
        }
    }

    pub fn push(&mut self, data: &[u8]) -> Result<u64> {
        if self.closed.load(Ordering::Acquire) {
            return Err(QueueError::Closed);
        }

        self.ensure_write_segment(data.len())?;

        let seg = self.write_segment.as_mut().unwrap();
        let pos = self.meta.write_pos();
        let record_size = seg.write_record(pos, data);
        self.meta.set_write_pos(pos + record_size as u64);
        let seq = self.meta.inc_write_seq();
        Ok(seq)
    }

    pub fn try_push(&mut self, data: &[u8]) -> Result<u64> {
        self.push(data) // push never blocks for an unbounded queue
    }

    pub fn peek(&mut self) -> Result<Option<(u64, Vec<u8>)>> {
        if self.closed.load(Ordering::Acquire) {
            return Err(QueueError::Closed);
        }

        if self.meta.read_seq() >= self.meta.write_seq() {
            return Ok(None);
        }

        if !self.ensure_read_segment()? {
            return Ok(None);
        }

        let seg = self.read_segment.as_ref().unwrap();
        let pos = self.meta.read_pos();
        let (data, new_pos) = seg.read_record(pos)?;

        self.meta.set_read_pos(new_pos);
        let id = self.meta.inc_read_seq();

        Ok(Some((id, data)))
    }

    pub fn peek_n(&mut self, n: usize) -> Result<Vec<(u64, Vec<u8>)>> {
        let mut results = Vec::with_capacity(n);
        for _ in 0..n {
            match self.peek()? {
                Some(entry) => results.push(entry),
                None => break,
            }
        }
        Ok(results)
    }

    pub fn peek_after(&mut self, after_id: u64) -> Result<Vec<(u64, Vec<u8>)>> {
        if self.closed.load(Ordering::Acquire) {
            return Err(QueueError::Closed);
        }

        let write_seq = self.meta.write_seq();
        let target_seq = after_id + 1;

        if target_seq >= write_seq {
            return Ok(vec![]);
        }

        // Rewind to committed position, then advance to target
        self.rewind_peek()?;

        let commit_seq = self.meta.commit_seq();

        // Skip records from commit_seq up to target_seq
        if target_seq > commit_seq {
            let skip = (target_seq - commit_seq) as usize;
            for _ in 0..skip {
                if self.peek()?.is_none() {
                    return Ok(vec![]);
                }
            }
        }

        // Read all remaining records
        let remaining = (write_seq - self.meta.read_seq()) as usize;
        self.peek_n(remaining)
    }

    pub fn commit(&mut self) -> Result<()> {
        let read_seg = self.meta.read_seg();
        let read_pos = self.meta.read_pos();
        let read_seq = self.meta.read_seq();

        let old_commit_seg = self.meta.commit_seg();

        self.meta.set_commit_seg(read_seg);
        self.meta.set_commit_pos(read_pos);
        self.meta.set_commit_seq(read_seq);

        // Delete fully consumed segments
        for seg_id in old_commit_seg..read_seg {
            Segment::delete(&self.dir, seg_id)?;
        }

        Ok(())
    }

    pub fn commit_n(&mut self, n: usize) -> Result<()> {
        let peeked = self.meta.read_seq() - self.meta.commit_seq();
        if (n as u64) > peeked {
            return Err(QueueError::InvalidCommit {
                requested: n as u64,
                available: peeked,
            });
        }

        // We need to walk forward from commit position by exactly n records
        // to find the new commit position
        let mut seg_id = self.meta.commit_seg();
        let mut pos = self.meta.commit_pos();
        let mut remaining = n;

        while remaining > 0 {
            let seg_path = Segment::path(&self.dir, seg_id);
            if !seg_path.exists() {
                // Should not happen if peeked count is correct
                break;
            }
            let seg = Segment::open(&self.dir, seg_id)?;
            while remaining > 0 && seg.has_record_at(pos) {
                match seg.read_record(pos) {
                    Ok((_, next_pos)) => {
                        pos = next_pos;
                        remaining -= 1;
                    }
                    Err(_) => break,
                }
            }
            if remaining > 0 {
                // Advance to next segment
                seg_id += 1;
                pos = 0;
            }
        }

        // Delete segments before the new commit segment
        let old_commit_seg = self.meta.commit_seg();
        for s in old_commit_seg..seg_id {
            Segment::delete(&self.dir, s)?;
        }

        self.meta.set_commit_seg(seg_id);
        self.meta.set_commit_pos(pos);
        self.meta.set_commit_seq(self.meta.commit_seq() + n as u64);

        Ok(())
    }

    pub fn pop(&mut self) -> Result<Vec<u8>> {
        match self.peek()? {
            Some((_id, data)) => {
                self.commit()?;
                Ok(data)
            }
            None => Err(QueueError::Empty),
        }
    }

    pub fn try_pop(&mut self) -> Result<Option<Vec<u8>>> {
        match self.peek()? {
            Some((_id, data)) => {
                self.commit()?;
                Ok(Some(data))
            }
            None => Ok(None),
        }
    }

    /// Reset the read (peek) cursor back to the committed position.
    /// This discards any in-progress peek batch, allowing the next peek
    /// to re-read from the last committed record.
    pub fn rewind_peek(&mut self) -> Result<()> {
        self.meta.set_read_seg(self.meta.commit_seg());
        self.meta.set_read_pos(self.meta.commit_pos());
        self.meta.set_read_seq(self.meta.commit_seq());
        // Force re-open of the read segment on next peek
        self.read_segment = None;
        Ok(())
    }

    pub fn size(&self) -> u64 {
        let write_seq = self.meta.write_seq();
        let commit_seq = self.meta.commit_seq();
        write_seq.saturating_sub(commit_seq)
    }

    pub fn is_empty(&self) -> bool {
        self.meta.write_seq() == self.meta.commit_seq()
    }

    pub fn close(&self) {
        self.closed.store(true, Ordering::Release);
    }
}
