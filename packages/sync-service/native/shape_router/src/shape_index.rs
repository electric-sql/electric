use ahash::{AHashMap, AHashSet};
use crate::varint;

/// Shape index: maps PK hashes to shape IDs
/// Two-tier structure: base (immutable MPHF) + delta (mutable overlay)
pub struct ShapeIndex {
    base: Option<BaseIndex>,
    delta: DeltaOverlay,
    tombstones: AHashSet<u32>, // Deleted shape IDs
}

impl ShapeIndex {
    pub fn new() -> Self {
        Self {
            base: None,
            delta: DeltaOverlay::new(),
            tombstones: AHashSet::new(),
        }
    }

    /// Lookup shape IDs for a given PK hash
    pub fn lookup(&self, pk_hash: u64) -> Option<Vec<u32>> {
        // Check delta first (more recent)
        if let Some(shapes) = self.delta.lookup(pk_hash) {
            return Some(self.filter_tombstones(shapes));
        }

        // Fall back to base
        if let Some(base) = &self.base {
            if let Some(shapes) = base.lookup(pk_hash) {
                return Some(self.filter_tombstones(shapes));
            }
        }

        None
    }

    /// Add a (pk_hash, shape_id) mapping to delta
    pub fn add_to_delta(&mut self, pk_hash: u64, shape_id: u32) {
        self.delta.add(pk_hash, shape_id);
    }

    /// Mark a shape as deleted (tombstone)
    pub fn mark_shape_deleted(&mut self, shape_id: u32) {
        self.tombstones.insert(shape_id);
    }

    /// Collect all present PK hashes (for rebuilding presence filter)
    pub fn collect_all_present_keys(&self) -> Vec<u64> {
        let mut keys = AHashSet::new();

        // Collect from base
        if let Some(base) = &self.base {
            keys.extend(base.all_keys());
        }

        // Collect from delta
        keys.extend(self.delta.all_keys());

        keys.into_iter().collect()
    }

    /// Get delta size (for rebuild policy)
    pub fn delta_size(&self) -> usize {
        self.delta.size()
    }

    /// Get tombstone count
    pub fn tombstone_count(&self) -> usize {
        self.tombstones.len()
    }

    fn filter_tombstones(&self, shapes: Vec<u32>) -> Vec<u32> {
        if self.tombstones.is_empty() {
            return shapes;
        }
        shapes
            .into_iter()
            .filter(|s| !self.tombstones.contains(s))
            .collect()
    }
}

/// Base index: immutable, built periodically
/// In production: use PTHash MPHF + packed shape-id pool
/// For prototype: simplified hash map
struct BaseIndex {
    // Simplified: just use a hash map
    // Production would use: MPHF function + offsets array + varint-encoded pool
    map: AHashMap<u64, Vec<u32>>,
}

impl BaseIndex {
    #[allow(dead_code)]
    fn build(entries: &[(u64, Vec<u32>)]) -> Self {
        let mut map = AHashMap::with_capacity(entries.len());
        for (pk_hash, shapes) in entries {
            map.insert(*pk_hash, shapes.clone());
        }
        Self { map }
    }

    fn lookup(&self, pk_hash: u64) -> Option<Vec<u32>> {
        self.map.get(&pk_hash).cloned()
    }

    fn all_keys(&self) -> Vec<u64> {
        self.map.keys().copied().collect()
    }
}

/// Delta overlay: mutable, holds recent changes
/// Uses Robin-Hood/Swiss-style open addressing
pub struct DeltaOverlay {
    // Simplified: AHashMap (which uses Swiss tables internally)
    // Each PK can map to multiple shapes
    map: AHashMap<u64, Vec<u32>>,
}

impl DeltaOverlay {
    fn new() -> Self {
        Self {
            map: AHashMap::new(),
        }
    }

    fn add(&mut self, pk_hash: u64, shape_id: u32) {
        self.map.entry(pk_hash).or_insert_with(Vec::new).push(shape_id);
    }

    fn lookup(&self, pk_hash: u64) -> Option<Vec<u32>> {
        self.map.get(&pk_hash).cloned()
    }

    fn all_keys(&self) -> Vec<u64> {
        self.map.keys().copied().collect()
    }

    fn size(&self) -> usize {
        self.map.len()
    }
}

/// Shape ID pool encoding
/// Uses varint (ULEB128) for compact storage
#[allow(dead_code)]
pub struct ShapeIdPool {
    data: Vec<u8>,
}

impl ShapeIdPool {
    #[allow(dead_code)]
    fn new() -> Self {
        Self { data: Vec::new() }
    }

    #[allow(dead_code)]
    fn encode_shapes(&mut self, shapes: &[u32]) -> u32 {
        let offset = self.data.len() as u32;

        // Length prefix
        varint::encode_u32(&mut self.data, shapes.len() as u32);

        // Shape IDs
        for &shape_id in shapes {
            varint::encode_u32(&mut self.data, shape_id);
        }

        offset
    }

    #[allow(dead_code)]
    fn decode_shapes(&self, offset: u32) -> Vec<u32> {
        let mut cursor = offset as usize;

        // Read length
        let (count, bytes_read) = varint::decode_u32(&self.data[cursor..]);
        cursor += bytes_read;

        // Read shape IDs
        let mut shapes = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let (shape_id, bytes_read) = varint::decode_u32(&self.data[cursor..]);
            shapes.push(shape_id);
            cursor += bytes_read;
        }

        shapes
    }

    #[allow(dead_code)]
    fn memory_bytes(&self) -> usize {
        self.data.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_delta_overlay() {
        let mut delta = DeltaOverlay::new();

        delta.add(100, 1);
        delta.add(100, 2);
        delta.add(200, 3);

        assert_eq!(delta.lookup(100), Some(vec![1, 2]));
        assert_eq!(delta.lookup(200), Some(vec![3]));
        assert_eq!(delta.lookup(300), None);
    }

    #[test]
    fn test_shape_id_pool() {
        let mut pool = ShapeIdPool::new();

        let shapes1 = vec![1, 2, 3];
        let offset1 = pool.encode_shapes(&shapes1);

        let shapes2 = vec![100, 200];
        let offset2 = pool.encode_shapes(&shapes2);

        assert_eq!(pool.decode_shapes(offset1), shapes1);
        assert_eq!(pool.decode_shapes(offset2), shapes2);

        // Check memory efficiency
        // 3 shapes (1,2,3) = 1 byte length + 3*1 byte = 4 bytes
        // 2 shapes (100,200) = 1 byte length + 2*2 bytes = 5 bytes
        // Total = 9 bytes
        println!("Pool size: {} bytes", pool.memory_bytes());
    }
}
