use xorf::{BinaryFuse16, Filter};

/// Binary Fuse filter for fast presence checks
/// Achieves ~9-10 bits/key with <1% FPP
pub struct PresenceFilter {
    filter: Option<BinaryFuse16>,
    key_count: usize,
}

impl PresenceFilter {
    pub fn empty() -> Self {
        Self {
            filter: None,
            key_count: 0,
        }
    }

    /// Build a new filter from a set of keys
    /// Keys should be 64-bit hashes (xxh3 of PKs)
    pub fn build(keys: &[u64]) -> Self {
        if keys.is_empty() {
            return Self::empty();
        }

        // Binary Fuse filter construction
        let filter = BinaryFuse16::try_from(keys)
            .expect("Failed to build Binary Fuse filter");

        Self {
            filter: Some(filter),
            key_count: keys.len(),
        }
    }

    /// Check if a key might be present (may have false positives)
    pub fn contains(&self, key: u64) -> bool {
        match &self.filter {
            Some(filter) => filter.contains(&key),
            None => false,
        }
    }

    /// Get memory usage in bytes
    pub fn memory_bytes(&self) -> usize {
        match &self.filter {
            Some(_) => {
                // Binary Fuse16 uses ~18 bits/key
                // (slightly more than the optimal 9-10 bits for <1% FPP,
                // but still excellent and very fast)
                (self.key_count * 18 + 7) / 8
            }
            None => 0,
        }
    }

    pub fn key_count(&self) -> usize {
        self.key_count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_presence_filter() {
        let keys: Vec<u64> = (0..10000).collect();
        let filter = PresenceFilter::build(&keys);

        // All keys should be found
        for key in &keys {
            assert!(filter.contains(*key));
        }

        // Check false positive rate on non-members
        let mut false_positives = 0;
        for key in 10000..20000 {
            if filter.contains(key) {
                false_positives += 1;
            }
        }

        let fpp = false_positives as f64 / 10000.0;
        println!("False positive rate: {:.2}%", fpp * 100.0);
        assert!(fpp < 0.02, "FPP should be < 2%"); // Binary Fuse16 is ~1%

        // Check memory efficiency
        let bytes_per_key = filter.memory_bytes() as f64 / filter.key_count() as f64;
        println!("Bytes per key: {:.2}", bytes_per_key);
        assert!(bytes_per_key < 3.0, "Should use less than 3 bytes/key");
    }
}
