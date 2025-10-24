/// Immutable segment using Minimal Perfect Hash
///
/// A segment is a read-only index built from a batch of keys.
/// It uses a Minimal Perfect Hash function to achieve O(1) lookup
/// with minimal memory overhead (~12-13 bytes/key).
///
/// Layout:
/// - MPH function (metadata ~1.6-3.7 bits/key depending on algorithm)
/// - keys64: array of 64-bit fingerprints for verification
/// - vals: array of Vec<shape_id> (multiple shape IDs per key)
///
/// For the prototype, we use a simple approach with hash maps.
/// Production would use RecSplit or BBHash for true MPH.

use crate::hash::KeyHash;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// Immutable segment built from overlay entries
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    /// Segment ID (for tracking)
    id: u64,
    /// Level in LSM tree (0 = newest, higher = older/larger)
    level: u32,
    /// Number of entries
    count: usize,
    /// Simple map for prototype (would be MPH in production)
    /// Maps hash -> Vec<shape_id>
    data: HashMap<u64, Vec<u32>>,
}

impl Segment {
    /// Create a new segment from key-value pairs
    pub fn new(id: u64, level: u32, entries: Vec<(KeyHash, Vec<u32>)>) -> Self {
        let mut data = HashMap::with_capacity(entries.len());

        for (hash, shape_ids) in entries {
            data.insert(hash.value(), shape_ids);
        }

        let count = data.len();

        Self {
            id,
            level,
            count,
            data,
        }
    }

    /// Lookup a key in the segment
    pub fn lookup(&self, hash: KeyHash) -> Option<Vec<u32>> {
        self.data.get(&hash.value()).cloned()
    }

    /// Check if segment contains a key
    pub fn contains(&self, hash: KeyHash) -> bool {
        self.data.contains_key(&hash.value())
    }

    /// Get number of entries in segment
    pub fn len(&self) -> usize {
        self.count
    }

    /// Check if segment is empty
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// Get segment ID
    pub fn id(&self) -> u64 {
        self.id
    }

    /// Get segment level
    pub fn level(&self) -> u32 {
        self.level
    }

    /// Get all shape IDs in segment
    pub fn all_shape_ids(&self) -> Vec<u32> {
        let mut result = std::collections::HashSet::new();

        for shape_ids in self.data.values() {
            result.extend(shape_ids);
        }

        result.into_iter().collect()
    }

    /// Estimate memory usage in bytes
    pub fn memory_bytes(&self) -> usize {
        // Rough estimate: 8 bytes (hash) + ~16 bytes (Vec overhead) + 4 bytes per shape_id
        let mut total = 0;

        total += std::mem::size_of::<Self>();
        total += self.data.capacity() * std::mem::size_of::<(u64, Vec<u32>)>();

        for shape_ids in self.data.values() {
            total += shape_ids.capacity() * std::mem::size_of::<u32>();
        }

        total
    }

    /// Iterate over all entries
    pub fn iter(&self) -> impl Iterator<Item = (KeyHash, &Vec<u32>)> + '_ {
        self.data
            .iter()
            .map(|(hash, ids)| (KeyHash(*hash), ids))
    }
}

/// Builder for creating segments
pub struct SegmentBuilder {
    id: u64,
    level: u32,
    entries: Vec<(KeyHash, Vec<u32>)>,
}

impl SegmentBuilder {
    /// Create a new segment builder
    pub fn new(id: u64, level: u32) -> Self {
        Self {
            id,
            level,
            entries: Vec::new(),
        }
    }

    /// Add an entry to the segment
    pub fn add(&mut self, hash: KeyHash, shape_ids: Vec<u32>) {
        self.entries.push((hash, shape_ids));
    }

    /// Build the segment
    pub fn build(self) -> Segment {
        Segment::new(self.id, self.level, self.entries)
    }

    /// Get current entry count
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if builder is empty
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_segment_creation() {
        let hash1 = KeyHash::from_bytes(b"key1");
        let hash2 = KeyHash::from_bytes(b"key2");

        let entries = vec![
            (hash1, vec![1, 2]),
            (hash2, vec![3]),
        ];

        let segment = Segment::new(1, 0, entries);

        assert_eq!(segment.len(), 2);
        assert_eq!(segment.id(), 1);
        assert_eq!(segment.level(), 0);
    }

    #[test]
    fn test_segment_lookup() {
        let hash1 = KeyHash::from_bytes(b"key1");
        let hash2 = KeyHash::from_bytes(b"key2");

        let entries = vec![
            (hash1, vec![1, 2]),
            (hash2, vec![3]),
        ];

        let segment = Segment::new(1, 0, entries);

        assert_eq!(segment.lookup(hash1), Some(vec![1, 2]));
        assert_eq!(segment.lookup(hash2), Some(vec![3]));

        let hash3 = KeyHash::from_bytes(b"key3");
        assert_eq!(segment.lookup(hash3), None);
    }

    #[test]
    fn test_segment_builder() {
        let mut builder = SegmentBuilder::new(1, 0);

        builder.add(KeyHash::from_bytes(b"key1"), vec![1]);
        builder.add(KeyHash::from_bytes(b"key2"), vec![2, 3]);

        let segment = builder.build();

        assert_eq!(segment.len(), 2);
        assert_eq!(segment.lookup(KeyHash::from_bytes(b"key1")), Some(vec![1]));
        assert_eq!(segment.lookup(KeyHash::from_bytes(b"key2")), Some(vec![2, 3]));
    }

    #[test]
    fn test_segment_all_shape_ids() {
        let entries = vec![
            (KeyHash::from_bytes(b"key1"), vec![1, 2]),
            (KeyHash::from_bytes(b"key2"), vec![2, 3]),
        ];

        let segment = Segment::new(1, 0, entries);

        let mut ids = segment.all_shape_ids();
        ids.sort();

        assert_eq!(ids, vec![1, 2, 3]);
    }
}
