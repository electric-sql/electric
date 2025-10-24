/// LSM-based Route Index NIF for Electric
///
/// This is a prototype implementation of an LSM-style equality index using:
/// - Minimal Perfect Hash (MPH) functions for immutable segments
/// - Fast mutable overlay for recent changes
/// - Lane-based partitioning to bound read amplification
/// - Memory-mapped segment storage
/// - Atomic manifest swaps for zero-downtime updates
///
/// Design goals:
/// - 10-20μs lookup latency
/// - ~12-13 bytes/key memory footprint
/// - Support millions of keys
/// - High churn (constant add/remove)
/// - Multi-tenant support

mod hash;
mod overlay;
mod lane;
mod segment;
mod compaction;
mod manifest;

use rustler::{Env, Term, NifStruct, NifUnitEnum, ResourceArc};
use std::sync::Arc;
use parking_lot::RwLock;

// Re-export main types
pub use hash::KeyHash;
pub use overlay::Overlay;
pub use lane::{Lane, LaneId};
pub use segment::Segment;
pub use manifest::Manifest;

/// Main LSM index resource
/// This wraps the entire index state and is passed back to Elixir as an opaque reference
pub struct LsmIndex {
    /// Number of lanes for partitioning
    num_lanes: usize,
    /// Per-lane state (overlay + segments)
    lanes: Vec<Arc<RwLock<Lane>>>,
    /// Manifest tracking current generation
    manifest: Arc<RwLock<Manifest>>,
    /// Base directory for persistence (optional for prototype)
    base_path: Option<std::path::PathBuf>,
}

impl LsmIndex {
    /// Create a new LSM index with the given number of lanes
    pub fn new(num_lanes: usize, base_path: Option<std::path::PathBuf>) -> Self {
        let lanes = (0..num_lanes)
            .map(|id| Arc::new(RwLock::new(Lane::new(id as u32))))
            .collect();

        let manifest = Arc::new(RwLock::new(Manifest::new(num_lanes)));

        Self {
            num_lanes,
            lanes,
            manifest,
            base_path,
        }
    }

    /// Insert a key-value pair (key_hash -> shape_id)
    pub fn insert(&self, key: &[u8], shape_id: u32) -> Result<(), String> {
        let hash = KeyHash::from_bytes(key);
        let lane_id = hash.lane(self.num_lanes);

        let lane = &self.lanes[lane_id];
        let mut lane_guard = lane.write();
        lane_guard.insert(hash, shape_id);

        Ok(())
    }

    /// Remove a key
    pub fn remove(&self, key: &[u8], shape_id: u32) -> Result<(), String> {
        let hash = KeyHash::from_bytes(key);
        let lane_id = hash.lane(self.num_lanes);

        let lane = &self.lanes[lane_id];
        let mut lane_guard = lane.write();
        lane_guard.remove(hash, shape_id);

        Ok(())
    }

    /// Lookup a key, returning the associated shape_id if found
    pub fn lookup(&self, key: &[u8]) -> Option<Vec<u32>> {
        let hash = KeyHash::from_bytes(key);
        let lane_id = hash.lane(self.num_lanes);

        let lane = &self.lanes[lane_id];
        let lane_guard = lane.read();
        lane_guard.lookup(hash)
    }

    /// Get all shape IDs in the index
    pub fn all_shape_ids(&self) -> Vec<u32> {
        let mut result = std::collections::HashSet::new();

        for lane in &self.lanes {
            let lane_guard = lane.read();
            for shape_id in lane_guard.all_shape_ids() {
                result.insert(shape_id);
            }
        }

        result.into_iter().collect()
    }

    /// Check if the index is empty
    pub fn is_empty(&self) -> bool {
        self.lanes.iter().all(|lane| {
            let lane_guard = lane.read();
            lane_guard.is_empty()
        })
    }

    /// Trigger compaction on lanes that exceed threshold
    pub fn maybe_compact(&self, overlay_threshold: usize) -> Result<Vec<usize>, String> {
        let mut compacted_lanes = Vec::new();

        for (idx, lane) in self.lanes.iter().enumerate() {
            let should_compact = {
                let lane_guard = lane.read();
                lane_guard.overlay_size() >= overlay_threshold
            };

            if should_compact {
                // In prototype, we do synchronous compaction
                // Production would do this in background worker pool
                let mut lane_guard = lane.write();
                lane_guard.compact()?;
                compacted_lanes.push(idx);
            }
        }

        Ok(compacted_lanes)
    }

    /// Get statistics about the index
    pub fn stats(&self) -> IndexStats {
        let mut total_overlay_entries = 0;
        let mut total_segment_entries = 0;
        let mut total_segments = 0;

        for lane in &self.lanes {
            let lane_guard = lane.read();
            total_overlay_entries += lane_guard.overlay_size();
            total_segment_entries += lane_guard.segment_size();
            total_segments += lane_guard.segment_count();
        }

        IndexStats {
            num_lanes: self.num_lanes,
            total_overlay_entries,
            total_segment_entries,
            total_segments,
            total_entries: total_overlay_entries + total_segment_entries,
        }
    }
}

#[derive(Debug, Clone)]
pub struct IndexStats {
    pub num_lanes: usize,
    pub total_overlay_entries: usize,
    pub total_segment_entries: usize,
    pub total_segments: usize,
    pub total_entries: usize,
}

// NIF resource wrapper
pub struct LsmIndexResource {
    inner: Arc<LsmIndex>,
}

// NIF function exports
rustler::init!(
    "Elixir.Electric.Shapes.Filter.Indexes.LsmEqualityIndex.Nif",
    [
        nif_new,
        nif_insert,
        nif_remove,
        nif_lookup,
        nif_all_shape_ids,
        nif_is_empty,
        nif_maybe_compact,
        nif_stats,
    ],
    load = on_load
);

fn on_load(env: Env, _info: Term) -> bool {
    rustler::resource!(LsmIndexResource, env);
    true
}

/// Create a new LSM index
/// Args: (num_lanes: integer)
/// Returns: resource reference
#[rustler::nif]
fn nif_new(num_lanes: usize) -> ResourceArc<LsmIndexResource> {
    let index = LsmIndex::new(num_lanes, None);
    ResourceArc::new(LsmIndexResource {
        inner: Arc::new(index),
    })
}

/// Insert a key-value pair
/// Args: (index: resource, key: binary, shape_id: integer)
/// Returns: :ok | {:error, reason}
#[rustler::nif]
fn nif_insert(
    index: ResourceArc<LsmIndexResource>,
    key: rustler::Binary,
    shape_id: u32,
) -> Result<rustler::Atom, String> {
    index.inner.insert(key.as_slice(), shape_id)?;
    Ok(rustler::atoms::ok())
}

/// Remove a key
/// Args: (index: resource, key: binary, shape_id: integer)
/// Returns: :ok | {:error, reason}
#[rustler::nif]
fn nif_remove(
    index: ResourceArc<LsmIndexResource>,
    key: rustler::Binary,
    shape_id: u32,
) -> Result<rustler::Atom, String> {
    index.inner.remove(key.as_slice(), shape_id)?;
    Ok(rustler::atoms::ok())
}

/// Lookup a key
/// Args: (index: resource, key: binary)
/// Returns: [shape_id, ...] | nil
#[rustler::nif]
fn nif_lookup(
    index: ResourceArc<LsmIndexResource>,
    key: rustler::Binary,
) -> Option<Vec<u32>> {
    index.inner.lookup(key.as_slice())
}

/// Get all shape IDs
/// Args: (index: resource)
/// Returns: [shape_id, ...]
#[rustler::nif]
fn nif_all_shape_ids(index: ResourceArc<LsmIndexResource>) -> Vec<u32> {
    index.inner.all_shape_ids()
}

/// Check if empty
/// Args: (index: resource)
/// Returns: boolean
#[rustler::nif]
fn nif_is_empty(index: ResourceArc<LsmIndexResource>) -> bool {
    index.inner.is_empty()
}

/// Trigger compaction if needed
/// Args: (index: resource, overlay_threshold: integer)
/// Returns: {:ok, [compacted_lane_ids]} | {:error, reason}
#[rustler::nif]
fn nif_maybe_compact(
    index: ResourceArc<LsmIndexResource>,
    overlay_threshold: usize,
) -> Result<Vec<usize>, String> {
    index.inner.maybe_compact(overlay_threshold)
}

/// Get index statistics
/// Args: (index: resource)
/// Returns: map with stats
#[rustler::nif]
fn nif_stats(index: ResourceArc<LsmIndexResource>) -> NifIndexStats {
    let stats = index.inner.stats();
    NifIndexStats {
        num_lanes: stats.num_lanes,
        total_overlay_entries: stats.total_overlay_entries,
        total_segment_entries: stats.total_segment_entries,
        total_segments: stats.total_segments,
        total_entries: stats.total_entries,
    }
}

#[derive(NifStruct)]
#[module = "Electric.Shapes.Filter.Indexes.LsmEqualityIndex.Stats"]
pub struct NifIndexStats {
    pub num_lanes: usize,
    pub total_overlay_entries: usize,
    pub total_segment_entries: usize,
    pub total_segments: usize,
    pub total_entries: usize,
}
