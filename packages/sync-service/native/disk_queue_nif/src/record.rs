pub const RECORD_HEADER_SIZE: usize = 12;
pub const RECORD_MAGIC: u32 = 0x44515243; // "DQRC"

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct RecordHeader {
    pub magic: u32,
    pub length: u32,
    pub crc32: u32,
}

impl RecordHeader {
    pub fn new(data: &[u8]) -> Self {
        Self {
            magic: RECORD_MAGIC,
            length: data.len() as u32,
            crc32: crc32fast::hash(data),
        }
    }

    pub fn as_bytes(&self) -> &[u8] {
        unsafe {
            std::slice::from_raw_parts(
                self as *const Self as *const u8,
                std::mem::size_of::<Self>(),
            )
        }
    }

    pub fn from_bytes(bytes: &[u8]) -> Self {
        assert!(bytes.len() >= std::mem::size_of::<Self>());
        unsafe { std::ptr::read_unaligned(bytes.as_ptr() as *const Self) }
    }

    pub fn is_valid(&self) -> bool {
        self.magic == RECORD_MAGIC
    }
}

/// Total record size on disk, padded to 8-byte alignment.
pub fn padded_record_size(data_len: usize) -> usize {
    (RECORD_HEADER_SIZE + data_len + 7) & !7
}
