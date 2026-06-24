//! WAL record codec — **B-light framing** (header-CRC only, no payload CRC).
//!
//! Wire layout of one record (header is little-endian, [`HEADER_LEN`] = 33 bytes):
//!
//! ```text
//! u32  len            // payload length
//! u32  header_crc32c   // crc32c over [lsn, kind, stream_id, stream_offset, len]
//! u64  lsn            // monotonic within the shard
//! u8   kind           // 1=Append 2=StreamCreate 3=StreamClose 4=StreamDelete
//! u64  stream_id      // stable per-stream id
//! u64  stream_offset  // logical Stream-Next-Offset before this append
//! [len bytes payload]
//! ```
//!
//! **Torn-tail detection** (design spec §4): a record is complete iff its
//! `header_crc` validates **and** the segment holds `len` payload bytes after
//! the header. The first failure ends the durable log. There is deliberately no
//! payload CRC — same integrity as today's per-stream files. The header CRC
//! also doubles as a torn-header detector: a partially-written header almost
//! always fails the CRC, and an all-zero (`fallocate`'d, never-written) header
//! is treated as the clean end of the log, not a torn record.

/// Length of the fixed record header in bytes:
/// `u32 len + u32 header_crc + u64 lsn + u8 kind + u64 stream_id + u64 stream_offset`.
pub const HEADER_LEN: usize = 33;

/// Record kind discriminant. The numeric values are the on-disk encoding and
/// MUST remain stable across versions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum RecordKind {
    Append = 1,
    StreamCreate = 2,
    StreamClose = 3,
    StreamDelete = 4,
}

impl RecordKind {
    /// Decode a kind discriminant; returns `None` for an unknown byte (which a
    /// decoder treats as a corrupt/torn header).
    #[inline]
    pub fn from_u8(b: u8) -> Option<Self> {
        match b {
            1 => Some(RecordKind::Append),
            2 => Some(RecordKind::StreamCreate),
            3 => Some(RecordKind::StreamClose),
            4 => Some(RecordKind::StreamDelete),
            _ => None,
        }
    }
}

/// A WAL record to encode. Borrows its payload (zero-copy on the encode side).
#[derive(Debug)]
pub struct Record<'a> {
    pub lsn: u64,
    pub kind: RecordKind,
    pub stream_id: u64,
    pub stream_offset: u64,
    pub payload: &'a [u8],
}

/// Result of [`decode_at`].
#[derive(Debug)]
pub enum Decoded {
    /// A complete, CRC-valid record. Fields mirror the header plus the resolved
    /// payload slice bounds (`payload_off`, `len`) and the total on-disk size
    /// (`total = HEADER_LEN + len`) so the caller can advance to the next record.
    Record {
        lsn: u64,
        kind: RecordKind,
        stream_id: u64,
        stream_offset: u64,
        payload_off: usize,
        len: usize,
        total: usize,
    },
    /// Not enough bytes for even a header, or an all-zero (`fallocate`'d, never
    /// written) header — i.e. the clean end of the durable log, not corruption.
    Incomplete,
    /// A header is present but its CRC is bad, or its `len` payload bytes are not
    /// all present — a torn trailing record. The durable log ends before it.
    Torn,
}

/// Compute the header CRC over the logical field tuple
/// `[lsn, kind, stream_id, stream_offset, len]` (little-endian), matching the
/// order the spec specifies (NOT the on-disk byte order, which interleaves the
/// CRC). Used by both [`encode_into`] and [`decode_at`] so they cannot diverge.
#[inline]
fn header_crc(lsn: u64, kind: u8, stream_id: u64, stream_offset: u64, len: u32) -> u32 {
    let mut f = [0u8; 8 + 1 + 8 + 8 + 4];
    f[0..8].copy_from_slice(&lsn.to_le_bytes());
    f[8] = kind;
    f[9..17].copy_from_slice(&stream_id.to_le_bytes());
    f[17..25].copy_from_slice(&stream_offset.to_le_bytes());
    f[25..29].copy_from_slice(&len.to_le_bytes());
    crc32c::crc32c(&f)
}

/// Append the 33-byte framed **header only** (no payload) to `buf`.
///
/// This is the single canonical source of the header byte layout — both
/// [`encode_into`] and [`Shard::reserve_for_splice`] call it so the framing
/// cannot diverge between the two reservation paths.
///
/// `len` is the payload length in bytes (the on-disk `u32` field).
pub fn encode_header_into(
    buf: &mut Vec<u8>,
    lsn: u64,
    kind: RecordKind,
    stream_id: u64,
    stream_offset: u64,
    len: u32,
) {
    let kind_byte = kind as u8;
    let crc = header_crc(lsn, kind_byte, stream_id, stream_offset, len);
    buf.reserve(HEADER_LEN);
    buf.extend_from_slice(&len.to_le_bytes()); // [0..4)
    buf.extend_from_slice(&crc.to_le_bytes()); // [4..8)
    buf.extend_from_slice(&lsn.to_le_bytes()); // [8..16)
    buf.push(kind_byte); // [16]
    buf.extend_from_slice(&stream_id.to_le_bytes()); // [17..25)
    buf.extend_from_slice(&stream_offset.to_le_bytes()); // [25..33)
}

/// Append a framed record (header + payload) to `buf`.
pub fn encode_into(buf: &mut Vec<u8>, r: &Record) {
    encode_header_into(buf, r.lsn, r.kind, r.stream_id, r.stream_offset, r.payload.len() as u32);
    buf.extend_from_slice(r.payload); // [33..33+len)
}

/// Decode the record starting at byte `off` in segment `seg`.
///
/// See the module docs / spec §4 for `Torn` vs `Incomplete` semantics.
pub fn decode_at(seg: &[u8], off: usize) -> Decoded {
    // Need at least a full header.
    let Some(hdr) = seg.get(off..off + HEADER_LEN) else {
        return Decoded::Incomplete;
    };

    // All-zero header ⇒ fallocate'd, never-written tail ⇒ clean end of log.
    if hdr.iter().all(|&b| b == 0) {
        return Decoded::Incomplete;
    }

    let len = u32::from_le_bytes(hdr[0..4].try_into().unwrap());
    let crc = u32::from_le_bytes(hdr[4..8].try_into().unwrap());
    let lsn = u64::from_le_bytes(hdr[8..16].try_into().unwrap());
    let kind_byte = hdr[16];
    let stream_id = u64::from_le_bytes(hdr[17..25].try_into().unwrap());
    let stream_offset = u64::from_le_bytes(hdr[25..33].try_into().unwrap());

    // Validate the header CRC. A torn/partially-written header fails here.
    if header_crc(lsn, kind_byte, stream_id, stream_offset, len) != crc {
        return Decoded::Torn;
    }

    // CRC passed but kind is unknown ⇒ corrupt header ⇒ treat as torn.
    let Some(kind) = RecordKind::from_u8(kind_byte) else {
        return Decoded::Torn;
    };

    let len = len as usize;
    let payload_off = off + HEADER_LEN;
    let total = HEADER_LEN + len;

    // Header is valid; the full payload must follow or the record is torn.
    if seg.len() < off + total {
        return Decoded::Torn;
    }

    Decoded::Record {
        lsn,
        kind,
        stream_id,
        stream_offset,
        payload_off,
        len,
        total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_roundtrip_and_torn() {
        let mut b = Vec::new();
        let r = Record { lsn: 7, kind: RecordKind::Append, stream_id: 3, stream_offset: 100, payload: b"hello" };
        encode_into(&mut b, &r);
        match decode_at(&b, 0) {
            Decoded::Record { lsn, kind, stream_id, stream_offset, payload_off, len, total } => {
                assert_eq!((lsn, stream_id, stream_offset, len), (7, 3, 100, 5));
                assert!(matches!(kind, RecordKind::Append));
                assert_eq!(&b[payload_off..payload_off+len], b"hello");
                assert_eq!(total, HEADER_LEN + 5);
            }
            _ => panic!("expected Record"),
        }
        // torn payload: drop last byte → header says len=5 but only 4 present
        let torn = &b[..b.len()-1];
        assert!(matches!(decode_at(torn, 0), Decoded::Torn));
        // torn header (partial) and all-zero (fallocate) → not a Record
        assert!(matches!(decode_at(&b[..HEADER_LEN-1], 0), Decoded::Incomplete | Decoded::Torn));
        assert!(matches!(decode_at(&[0u8; HEADER_LEN+5], 0), Decoded::Incomplete | Decoded::Torn));
    }

    #[test]
    fn seq_decode_two_records_back_to_back() {
        // Encode two records into one buffer; decode_at must read the first at
        // off=0 and the second at off=t1 (exercises off>0 decode, the Task-1 gap).
        let mut b = Vec::new();
        let r1 = Record { lsn: 1, kind: RecordKind::Append, stream_id: 10, stream_offset: 0, payload: b"first" };
        let r2 = Record { lsn: 2, kind: RecordKind::StreamCreate, stream_id: 11, stream_offset: 5, payload: b"second-payload" };
        encode_into(&mut b, &r1);
        encode_into(&mut b, &r2);

        let t1 = match decode_at(&b, 0) {
            Decoded::Record { lsn, kind, stream_id, stream_offset, payload_off, len, total } => {
                assert_eq!((lsn, stream_id, stream_offset, len), (1, 10, 0, 5));
                assert!(matches!(kind, RecordKind::Append));
                assert_eq!(&b[payload_off..payload_off + len], b"first");
                assert_eq!(total, HEADER_LEN + 5);
                total
            }
            other => panic!("expected first Record, got {other:?}"),
        };

        match decode_at(&b, t1) {
            Decoded::Record { lsn, kind, stream_id, stream_offset, payload_off, len, total } => {
                assert_eq!((lsn, stream_id, stream_offset, len), (2, 11, 5, 14));
                assert!(matches!(kind, RecordKind::StreamCreate));
                assert_eq!(&b[payload_off..payload_off + len], b"second-payload");
                assert_eq!(total, HEADER_LEN + 14);
                // The two records tile the buffer exactly.
                assert_eq!(t1 + total, b.len());
            }
            other => panic!("expected second Record, got {other:?}"),
        }
    }
}
