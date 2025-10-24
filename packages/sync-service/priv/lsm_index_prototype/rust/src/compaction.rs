/// Background compaction logic
///
/// In production, this would be a separate worker pool that:
/// 1. Monitors overlay sizes across lanes
/// 2. Triggers compaction when thresholds are exceeded
/// 3. Builds new segments in background threads
/// 4. Atomically swaps in new segments via manifest
///
/// For the prototype, compaction is synchronous and triggered manually.

use crate::lane::Lane;

/// Compaction policy configuration
#[derive(Debug, Clone)]
pub struct CompactionPolicy {
    /// Overlay threshold (number of entries before compaction)
    pub overlay_threshold: usize,
    /// Maximum segments per lane before merging
    pub max_segments_per_lane: usize,
    /// Size ratio for leveled compaction (not implemented in prototype)
    pub size_ratio: usize,
}

impl Default for CompactionPolicy {
    fn default() -> Self {
        Self {
            overlay_threshold: 10_000,
            max_segments_per_lane: 3,
            size_ratio: 10,
        }
    }
}

/// Compaction scheduler
///
/// In production, this would be a background worker that:
/// - Monitors lane overlay sizes
/// - Schedules compaction tasks to worker pool
/// - Coordinates manifest updates
///
/// For prototype, this is just a simple synchronous trigger
pub struct CompactionScheduler {
    policy: CompactionPolicy,
}

impl CompactionScheduler {
    pub fn new(policy: CompactionPolicy) -> Self {
        Self { policy }
    }

    /// Check if a lane needs compaction
    pub fn needs_compaction(&self, lane: &Lane) -> bool {
        lane.overlay_size() >= self.policy.overlay_threshold
    }

    /// Get the compaction policy
    pub fn policy(&self) -> &CompactionPolicy {
        &self.policy
    }
}

impl Default for CompactionScheduler {
    fn default() -> Self {
        Self::new(CompactionPolicy::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::KeyHash;

    #[test]
    fn test_compaction_scheduler() {
        let policy = CompactionPolicy {
            overlay_threshold: 100,
            max_segments_per_lane: 3,
            size_ratio: 10,
        };

        let scheduler = CompactionScheduler::new(policy);

        let mut lane = Lane::new(0);

        // Lane doesn't need compaction when empty
        assert!(!scheduler.needs_compaction(&lane));

        // Add entries below threshold
        for i in 0..50 {
            let hash = KeyHash::from_bytes(format!("key{}", i).as_bytes());
            lane.insert(hash, i as u32);
        }

        assert!(!scheduler.needs_compaction(&lane));

        // Add entries above threshold
        for i in 50..150 {
            let hash = KeyHash::from_bytes(format!("key{}", i).as_bytes());
            lane.insert(hash, i as u32);
        }

        assert!(scheduler.needs_compaction(&lane));
    }
}
