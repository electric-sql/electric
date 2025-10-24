/// Lane-based partitioning for LSM index
///
/// Each lane is an independent LSM tree with:
/// - One mutable overlay for recent changes
/// - Multiple immutable segments (levels 0, 1, 2, ...)
///
/// Lookup probes:
/// 1. Overlay first (newest data)
/// 2. Segments from newest to oldest (L0 -> L1 -> L2 -> ...)
///
/// Compaction merges overlay into segments when threshold is exceeded.

use crate::hash::KeyHash;
use crate::overlay::{Overlay, OverlayEntry};
use crate::segment::{Segment, SegmentBuilder};
use std::collections::HashSet;

pub type LaneId = u32;

/// A single lane in the LSM index
#[derive(Debug)]
pub struct Lane {
    /// Lane identifier
    id: LaneId,
    /// Mutable overlay for recent changes
    overlay: Overlay,
    /// Immutable segments, ordered newest (L0) to oldest (Ln)
    segments: Vec<Segment>,
    /// Next segment ID (for tracking)
    next_segment_id: u64,
}

impl Lane {
    /// Create a new empty lane
    pub fn new(id: LaneId) -> Self {
        Self {
            id,
            overlay: Overlay::new(),
            segments: Vec::new(),
            next_segment_id: 0,
        }
    }

    /// Insert a key -> shape_id mapping
    pub fn insert(&mut self, hash: KeyHash, shape_id: u32) {
        self.overlay.insert(hash, shape_id);
    }

    /// Remove a key -> shape_id mapping
    pub fn remove(&mut self, hash: KeyHash, shape_id: u32) {
        self.overlay.remove(hash, shape_id);
    }

    /// Lookup a key
    ///
    /// Search order:
    /// 1. Overlay (newest)
    /// 2. Segments L0 -> Ln (newest to oldest)
    ///
    /// Returns first match found (newer values shadow older ones)
    pub fn lookup(&self, hash: KeyHash) -> Option<Vec<u32>> {
        // Check overlay first
        if let Some(ids) = self.overlay.lookup(hash) {
            return Some(ids);
        }

        // Check segments from newest to oldest
        for segment in &self.segments {
            if let Some(ids) = segment.lookup(hash) {
                return Some(ids);
            }
        }

        None
    }

    /// Get overlay size (number of entries)
    pub fn overlay_size(&self) -> usize {
        self.overlay.len()
    }

    /// Get total segment size (number of entries)
    pub fn segment_size(&self) -> usize {
        self.segments.iter().map(|s| s.len()).sum()
    }

    /// Get number of segments
    pub fn segment_count(&self) -> usize {
        self.segments.len()
    }

    /// Check if lane is empty
    pub fn is_empty(&self) -> bool {
        self.overlay.is_empty() && self.segments.is_empty()
    }

    /// Get all shape IDs in this lane
    pub fn all_shape_ids(&self) -> HashSet<u32> {
        let mut result = self.overlay.all_shape_ids();

        for segment in &self.segments {
            result.extend(segment.all_shape_ids());
        }

        result
    }

    /// Compact the overlay into a segment
    ///
    /// This is a simplified compaction for the prototype:
    /// 1. Create new L0 segment from overlay
    /// 2. Clear overlay
    /// 3. Optionally merge segments if too many levels
    ///
    /// Production would do background leveled compaction with size ratios
    pub fn compact(&mut self) -> Result<(), String> {
        if self.overlay.is_empty() {
            return Ok(());
        }

        // Build segment from overlay
        let segment_id = self.next_segment_id;
        self.next_segment_id += 1;

        let mut builder = SegmentBuilder::new(segment_id, 0);

        for (hash, entry) in self.overlay.iter() {
            if let OverlayEntry::Present(ids) = entry {
                let shape_ids: Vec<u32> = ids.iter().copied().collect();
                builder.add(hash, shape_ids);
            }
            // Skip tombstones (they remove keys from segments)
        }

        let new_segment = builder.build();

        // Clear overlay
        self.overlay.clear();

        // Add segment at front (newest)
        self.segments.insert(0, new_segment);

        // Optionally merge segments if we have too many
        // For prototype, we keep it simple - max 3 segments per lane
        if self.segments.len() > 3 {
            self.merge_segments()?;
        }

        Ok(())
    }

    /// Merge segments when there are too many
    ///
    /// Simplified for prototype: merge all segments into one
    /// Production would use leveled compaction with size ratios
    fn merge_segments(&mut self) -> Result<(), String> {
        if self.segments.len() <= 1 {
            return Ok(());
        }

        let segment_id = self.next_segment_id;
        self.next_segment_id += 1;

        // Collect all entries from all segments
        let mut merged_entries: std::collections::HashMap<u64, Vec<u32>> =
            std::collections::HashMap::new();

        // Process segments from oldest to newest so newer values overwrite older
        for segment in self.segments.iter().rev() {
            for (hash, ids) in segment.iter() {
                merged_entries.insert(hash.value(), ids.clone());
            }
        }

        // Build new merged segment
        let entries: Vec<(KeyHash, Vec<u32>)> = merged_entries
            .into_iter()
            .map(|(hash, ids)| (KeyHash(hash), ids))
            .collect();

        let merged_segment = Segment::new(segment_id, 1, entries);

        // Replace all segments with merged one
        self.segments.clear();
        self.segments.push(merged_segment);

        Ok(())
    }

    /// Get statistics about this lane
    pub fn stats(&self) -> LaneStats {
        LaneStats {
            id: self.id,
            overlay_entries: self.overlay.len(),
            segment_count: self.segments.len(),
            total_segment_entries: self.segment_size(),
            total_entries: self.overlay.len() + self.segment_size(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct LaneStats {
    pub id: LaneId,
    pub overlay_entries: usize,
    pub segment_count: usize,
    pub total_segment_entries: usize,
    pub total_entries: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lane_insert_lookup() {
        let mut lane = Lane::new(0);
        let hash = KeyHash::from_bytes(b"test_key");

        lane.insert(hash, 1);
        assert_eq!(lane.lookup(hash), Some(vec![1]));

        lane.insert(hash, 2);
        let mut result = lane.lookup(hash).unwrap();
        result.sort();
        assert_eq!(result, vec![1, 2]);
    }

    #[test]
    fn test_lane_remove() {
        let mut lane = Lane::new(0);
        let hash = KeyHash::from_bytes(b"test_key");

        lane.insert(hash, 1);
        lane.remove(hash, 1);

        assert_eq!(lane.lookup(hash), None);
    }

    #[test]
    fn test_lane_compaction() {
        let mut lane = Lane::new(0);

        // Add some entries
        for i in 0..100 {
            let key = format!("key{}", i);
            let hash = KeyHash::from_bytes(key.as_bytes());
            lane.insert(hash, i as u32);
        }

        assert_eq!(lane.overlay_size(), 100);
        assert_eq!(lane.segment_count(), 0);

        // Compact
        lane.compact().unwrap();

        assert_eq!(lane.overlay_size(), 0);
        assert_eq!(lane.segment_count(), 1);
        assert_eq!(lane.segment_size(), 100);

        // Verify lookups still work
        for i in 0..100 {
            let key = format!("key{}", i);
            let hash = KeyHash::from_bytes(key.as_bytes());
            assert_eq!(lane.lookup(hash), Some(vec![i as u32]));
        }
    }

    #[test]
    fn test_lane_overlay_shadows_segments() {
        let mut lane = Lane::new(0);
        let hash = KeyHash::from_bytes(b"test_key");

        // Add to overlay and compact
        lane.insert(hash, 1);
        lane.compact().unwrap();

        // Verify it's in segment
        assert_eq!(lane.lookup(hash), Some(vec![1]));

        // Update in overlay with new value
        lane.insert(hash, 2);

        // Overlay value should shadow segment value
        let mut result = lane.lookup(hash).unwrap();
        result.sort();
        assert_eq!(result, vec![1, 2]); // Both values present
    }

    #[test]
    fn test_lane_segment_merging() {
        let mut lane = Lane::new(0);

        // Add and compact multiple times to create multiple segments
        for batch in 0..5 {
            for i in 0..20 {
                let key = format!("key{}_{}", batch, i);
                let hash = KeyHash::from_bytes(key.as_bytes());
                lane.insert(hash, (batch * 20 + i) as u32);
            }
            lane.compact().unwrap();
        }

        // Should have merged down to max 3 segments
        assert!(lane.segment_count() <= 3);

        // Verify all entries are still accessible
        for batch in 0..5 {
            for i in 0..20 {
                let key = format!("key{}_{}", batch, i);
                let hash = KeyHash::from_bytes(key.as_bytes());
                assert_eq!(lane.lookup(hash), Some(vec![(batch * 20 + i) as u32]));
            }
        }
    }
}
