/// ULEB128 (LEB128) variable-length integer encoding
/// Achieves ~2 bytes/int for typical shape IDs (< 16384)

/// Encode a u32 as ULEB128 varint
pub fn encode_u32(buf: &mut Vec<u8>, mut value: u32) {
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;

        if value != 0 {
            byte |= 0x80; // Set continuation bit
        }

        buf.push(byte);

        if value == 0 {
            break;
        }
    }
}

/// Decode a u32 from ULEB128 varint
/// Returns (value, bytes_read)
pub fn decode_u32(buf: &[u8]) -> (u32, usize) {
    let mut result = 0u32;
    let mut shift = 0;
    let mut bytes_read = 0;

    for &byte in buf.iter().take(5) {
        // u32 needs at most 5 bytes
        bytes_read += 1;
        result |= ((byte & 0x7F) as u32) << shift;

        if byte & 0x80 == 0 {
            break;
        }

        shift += 7;
    }

    (result, bytes_read)
}

/// Calculate encoded size of a u32
pub fn encoded_size(value: u32) -> usize {
    if value < 128 {
        1
    } else if value < 16384 {
        2
    } else if value < 2097152 {
        3
    } else if value < 268435456 {
        4
    } else {
        5
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_varint_roundtrip() {
        let test_values = vec![
            0, 1, 127, 128, 255, 256,
            16383, 16384, 65535, 65536,
            1048575, 1048576,
            (1u32 << 31) - 1, // Max positive value
        ];

        for value in test_values {
            let mut buf = Vec::new();
            encode_u32(&mut buf, value);

            let (decoded, bytes_read) = decode_u32(&buf);

            assert_eq!(decoded, value, "Failed for value {}", value);
            assert_eq!(bytes_read, buf.len(), "Bytes read mismatch for value {}", value);
            assert_eq!(encoded_size(value), buf.len(), "Size calculation wrong for value {}", value);

            println!("Value {} encoded in {} bytes", value, buf.len());
        }
    }

    #[test]
    fn test_typical_shape_ids() {
        // Typical shape IDs are small (< 1000)
        let mut total_bytes = 0;
        let count = 1000;

        for id in 0..count {
            let mut buf = Vec::new();
            encode_u32(&mut buf, id);
            total_bytes += buf.len();
        }

        let avg_bytes = total_bytes as f64 / count as f64;
        println!("Average bytes per ID (0-999): {:.2}", avg_bytes);
        assert!(avg_bytes < 2.0, "Should average less than 2 bytes for small IDs");
    }
}
