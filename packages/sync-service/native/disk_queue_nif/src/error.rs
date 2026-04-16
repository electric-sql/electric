use std::io;

#[derive(Debug, thiserror::Error)]
pub enum QueueError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),

    #[error("Invalid file: bad magic number")]
    BadMagic,

    #[error("Unsupported version: {0}")]
    UnsupportedVersion(u32),

    #[error("Corrupted record at segment {seg_id} offset {offset}: {reason}")]
    CorruptedRecord {
        seg_id: u64,
        offset: u64,
        reason: String,
    },

    #[error("Queue is empty")]
    Empty,

    #[error("Queue is closed")]
    Closed,

    #[error("Operation timed out")]
    Timeout,

    #[error("Invalid commit: requested {requested} but only {available} peeked")]
    InvalidCommit { requested: u64, available: u64 },
}

pub type Result<T> = std::result::Result<T, QueueError>;
