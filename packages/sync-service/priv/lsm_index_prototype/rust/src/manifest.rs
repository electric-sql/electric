/// Manifest management for LSM index
///
/// The manifest tracks the current state of the index:
/// - Number of lanes
/// - Per-lane segment list
/// - Generation/version number
///
/// For atomic updates:
/// 1. Write new manifest to temp file
/// 2. fsync
/// 3. rename to manifest.json (atomic on POSIX)
///
/// This allows zero-downtime updates and easy backup/restore.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Manifest tracking index state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    /// Format version
    pub version: u32,
    /// Number of lanes
    pub num_lanes: usize,
    /// Generation number (incremented on each update)
    pub generation: u64,
    /// Per-lane metadata
    pub lanes: Vec<LaneManifest>,
}

impl Manifest {
    /// Create a new manifest
    pub fn new(num_lanes: usize) -> Self {
        let lanes = (0..num_lanes)
            .map(|id| LaneManifest::new(id as u32))
            .collect();

        Self {
            version: 1,
            num_lanes,
            generation: 0,
            lanes,
        }
    }

    /// Load manifest from file
    pub fn load(path: &Path) -> Result<Self, String> {
        let contents = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read manifest: {}", e))?;

        let manifest: Manifest = serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse manifest: {}", e))?;

        Ok(manifest)
    }

    /// Save manifest to file atomically
    ///
    /// Uses the write-to-temp-then-rename pattern for atomicity:
    /// 1. Write to manifest.json.tmp
    /// 2. fsync
    /// 3. rename to manifest.json
    pub fn save(&mut self, path: &Path) -> Result<(), String> {
        // Increment generation
        self.generation += 1;

        // Serialize to JSON
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize manifest: {}", e))?;

        // Write to temp file
        let temp_path = path.with_extension("json.tmp");
        std::fs::write(&temp_path, json)
            .map_err(|e| format!("Failed to write manifest: {}", e))?;

        // fsync (ensure data is on disk)
        let file = std::fs::File::open(&temp_path)
            .map_err(|e| format!("Failed to open temp manifest: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to fsync manifest: {}", e))?;

        // Atomic rename
        std::fs::rename(&temp_path, path)
            .map_err(|e| format!("Failed to rename manifest: {}", e))?;

        Ok(())
    }

    /// Get lane manifest by ID
    pub fn get_lane(&self, lane_id: u32) -> Option<&LaneManifest> {
        self.lanes.iter().find(|l| l.id == lane_id)
    }

    /// Get mutable lane manifest by ID
    pub fn get_lane_mut(&mut self, lane_id: u32) -> Option<&mut LaneManifest> {
        self.lanes.iter_mut().find(|l| l.id == lane_id)
    }
}

/// Per-lane manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneManifest {
    /// Lane ID
    pub id: u32,
    /// List of segments (newest first)
    pub segments: Vec<SegmentMetadata>,
    /// Overlay sequence number
    pub overlay_seqno: u64,
}

impl LaneManifest {
    pub fn new(id: u32) -> Self {
        Self {
            id,
            segments: Vec::new(),
            overlay_seqno: 0,
        }
    }

    /// Add a segment to the manifest
    pub fn add_segment(&mut self, metadata: SegmentMetadata) {
        self.segments.insert(0, metadata); // Add at front (newest)
    }

    /// Remove a segment by ID
    pub fn remove_segment(&mut self, segment_id: u64) {
        self.segments.retain(|s| s.id != segment_id);
    }
}

/// Metadata for a segment file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentMetadata {
    /// Segment ID
    pub id: u64,
    /// Level in LSM tree
    pub level: u32,
    /// Number of entries
    pub count: usize,
    /// File path (relative to base)
    pub path: PathBuf,
    /// Checksum (SHA-256) for integrity
    pub checksum: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_manifest_creation() {
        let manifest = Manifest::new(64);
        assert_eq!(manifest.num_lanes, 64);
        assert_eq!(manifest.lanes.len(), 64);
        assert_eq!(manifest.generation, 0);
    }

    #[test]
    fn test_manifest_save_load() {
        let temp_dir = std::env::temp_dir();
        let manifest_path = temp_dir.join("test_manifest.json");

        // Clean up if exists
        let _ = fs::remove_file(&manifest_path);

        let mut manifest = Manifest::new(8);
        manifest.save(&manifest_path).unwrap();

        let loaded = Manifest::load(&manifest_path).unwrap();
        assert_eq!(loaded.num_lanes, 8);
        assert_eq!(loaded.generation, 1); // Incremented on save

        // Clean up
        let _ = fs::remove_file(&manifest_path);
    }

    #[test]
    fn test_lane_manifest() {
        let mut lane = LaneManifest::new(0);

        let segment = SegmentMetadata {
            id: 1,
            level: 0,
            count: 100,
            path: PathBuf::from("lane-0/L0.seg"),
            checksum: Some("abc123".to_string()),
        };

        lane.add_segment(segment.clone());
        assert_eq!(lane.segments.len(), 1);
        assert_eq!(lane.segments[0].id, 1);

        lane.remove_segment(1);
        assert_eq!(lane.segments.len(), 0);
    }
}
