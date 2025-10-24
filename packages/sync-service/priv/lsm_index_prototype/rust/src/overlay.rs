/// Mutable overlay for recent changes
///
/// This is a fast in-memory hash table that holds recent updates.
/// When it grows too large, it's compacted into an immutable segment.
///
/// Uses AHashMap for fast hashing with good DOS resistance.
/// Each key can map to multiple shape IDs (for different where clauses).

use crate::hash::KeyHash;
use ahash::AHashMap;
use std::collections::HashSet;

/// Entry in the overlay
/// Supports both additions and deletions (tombstones)
#[derive(Debug, Clone)]
pub enum OverlayEntry {
    /// Key is present and maps to these shape IDs
    Present(HashSet<u32>),
    /// Key was deleted (tombstone marker)
    Deleted,
}

/// Fast mutable hash table for recent changes
#[derive(Debug, Clone)]
pub struct Overlay {
    /// Map from hash to shape IDs or tombstone
    entries: AHashMap<u64, OverlayEntry>,
    /// Generation/sequence number for versioning
    generation: u64,
}

impl Overlay {
    /// Create a new empty overlay
    pub fn new() -> Self {
        Self {
            entries: AHashMap::new(),
            generation: 0,
        }
    }

    /// Create a new overlay with preallocated capacity
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            entries: AHashMap::with_capacity(capacity),
            generation: 0,
        }
    }

    /// Insert a key -> shape_id mapping
    pub fn insert(&mut self, hash: KeyHash, shape_id: u32) {
        self.entries
            .entry(hash.value())
            .and_modify(|e| {
                if let OverlayEntry::Present(ref mut ids) = e {
                    ids.insert(shape_id);
                } else {
                    // Replace tombstone with new entry
                    *e = OverlayEntry::Present({
                        let mut set = HashSet::new();
                        set.insert(shape_id);
                        set
                    });
                }
            })
            .or_insert_with(|| {
                let mut set = HashSet::new();
                set.insert(shape_id);
                OverlayEntry::Present(set)
            });

        self.generation += 1;
    }

    /// Remove a key -> shape_id mapping
    pub fn remove(&mut self, hash: KeyHash, shape_id: u32) {
        self.entries
            .entry(hash.value())
            .and_modify(|e| {
                if let OverlayEntry::Present(ref mut ids) = e {
                    ids.remove(&shape_id);
                    // If no more shape IDs, mark as deleted
                    if ids.is_empty() {
                        *e = OverlayEntry::Deleted;
                    }
                }
            });

        self.generation += 1;
    }

    /// Lookup a key, returning shape IDs if present
    pub fn lookup(&self, hash: KeyHash) -> Option<Vec<u32>> {
        match self.entries.get(&hash.value()) {
            Some(OverlayEntry::Present(ids)) => {
                Some(ids.iter().copied().collect())
            }
            Some(OverlayEntry::Deleted) => None,
            None => None,
        }
    }

    /// Check if overlay contains a key (including tombstones)
    pub fn contains(&self, hash: KeyHash) -> bool {
        self.entries.contains_key(&hash.value())
    }

    /// Get number of entries (including tombstones)
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if overlay is empty
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Get current generation number
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Get all shape IDs in the overlay
    pub fn all_shape_ids(&self) -> HashSet<u32> {
        let mut result = HashSet::new();

        for entry in self.entries.values() {
            if let OverlayEntry::Present(ids) = entry {
                result.extend(ids);
            }
        }

        result
    }

    /// Iterate over all entries (for compaction)
    pub fn iter(&self) -> impl Iterator<Item = (KeyHash, &OverlayEntry)> + '_ {
        self.entries
            .iter()
            .map(|(hash, entry)| (KeyHash(*hash), entry))
    }

    /// Clear the overlay (after compaction)
    pub fn clear(&mut self) {
        self.entries.clear();
        self.generation = 0;
    }

    /// Merge another overlay into this one
    /// Used during compaction to consolidate overlays
    pub fn merge(&mut self, other: &Overlay) {
        for (hash, entry) in other.iter() {
            match entry {
                OverlayEntry::Present(ids) => {
                    for id in ids {
                        self.insert(hash, *id);
                    }
                }
                OverlayEntry::Deleted => {
                    self.entries.insert(hash.value(), OverlayEntry::Deleted);
                }
            }
        }
    }
}

impl Default for Overlay {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_overlay_insert_lookup() {
        let mut overlay = Overlay::new();
        let hash = KeyHash::from_bytes(b"test_key");

        overlay.insert(hash, 1);
        assert_eq!(overlay.lookup(hash), Some(vec![1]));

        // Insert another shape ID for same key
        overlay.insert(hash, 2);
        let mut result = overlay.lookup(hash).unwrap();
        result.sort();
        assert_eq!(result, vec![1, 2]);
    }

    #[test]
    fn test_overlay_remove() {
        let mut overlay = Overlay::new();
        let hash = KeyHash::from_bytes(b"test_key");

        overlay.insert(hash, 1);
        overlay.insert(hash, 2);

        overlay.remove(hash, 1);
        assert_eq!(overlay.lookup(hash), Some(vec![2]));

        overlay.remove(hash, 2);
        assert_eq!(overlay.lookup(hash), None);
    }

    #[test]
    fn test_overlay_tombstone() {
        let mut overlay = Overlay::new();
        let hash = KeyHash::from_bytes(b"test_key");

        overlay.insert(hash, 1);
        overlay.remove(hash, 1);

        // After removal, lookup returns None
        assert_eq!(overlay.lookup(hash), None);

        // But overlay contains the tombstone
        assert!(overlay.contains(hash));
    }

    #[test]
    fn test_overlay_all_shape_ids() {
        let mut overlay = Overlay::new();

        overlay.insert(KeyHash::from_bytes(b"key1"), 1);
        overlay.insert(KeyHash::from_bytes(b"key2"), 2);
        overlay.insert(KeyHash::from_bytes(b"key3"), 1); // Duplicate shape ID

        let ids = overlay.all_shape_ids();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&1));
        assert!(ids.contains(&2));
    }

    #[test]
    fn test_overlay_merge() {
        let mut overlay1 = Overlay::new();
        let mut overlay2 = Overlay::new();

        overlay1.insert(KeyHash::from_bytes(b"key1"), 1);
        overlay2.insert(KeyHash::from_bytes(b"key2"), 2);

        overlay1.merge(&overlay2);

        assert_eq!(overlay1.lookup(KeyHash::from_bytes(b"key1")), Some(vec![1]));
        assert_eq!(overlay1.lookup(KeyHash::from_bytes(b"key2")), Some(vec![2]));
    }
}
