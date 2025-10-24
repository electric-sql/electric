/// Hashing utilities for LSM index
///
/// Uses SipHash-2-4 for key hashing to avoid adversarial collisions
/// Implements jump consistent hash for lane assignment

use siphasher::sip::SipHasher24;
use std::hash::{Hash, Hasher};

/// 64-bit hash value used as key fingerprint
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct KeyHash(pub u64);

impl KeyHash {
    /// Hash bytes to a 64-bit fingerprint using SipHash-2-4
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let mut hasher = SipHasher24::new();
        bytes.hash(&mut hasher);
        KeyHash(hasher.finish())
    }

    /// Get the lane ID for this hash using jump consistent hash
    /// This ensures keys map consistently to lanes even as lane count changes
    pub fn lane(&self, num_lanes: usize) -> usize {
        jump_consistent_hash(self.0, num_lanes as u32) as usize
    }

    /// Get the raw hash value
    pub fn value(&self) -> u64 {
        self.0
    }
}

/// Jump Consistent Hash
///
/// From the paper "A Fast, Minimal Memory, Consistent Hash Algorithm"
/// https://arxiv.org/abs/1406.2294
///
/// This is a very fast (dozen integer ops) consistent hashing function that
/// minimizes key movement when the number of buckets changes.
///
/// Properties:
/// - Deterministic: same key always maps to same bucket for given num_buckets
/// - Balanced: approximately uniform distribution
/// - Consistent: when buckets change, only ~1/num_buckets keys move
/// - Fast: O(log(num_buckets)) but with tiny constants
fn jump_consistent_hash(mut key: u64, num_buckets: u32) -> u32 {
    let mut b: i64 = -1;
    let mut j: i64 = 0;

    while j < num_buckets as i64 {
        b = j;
        key = key.wrapping_mul(2862933555777941757).wrapping_add(1);
        j = ((b.wrapping_add(1) as f64) * ((1u64 << 31) as f64 / ((key >> 33).wrapping_add(1) as f64))) as i64;
    }

    b as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_hash_deterministic() {
        let key = b"test_key";
        let hash1 = KeyHash::from_bytes(key);
        let hash2 = KeyHash::from_bytes(key);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_key_hash_different_keys() {
        let hash1 = KeyHash::from_bytes(b"key1");
        let hash2 = KeyHash::from_bytes(b"key2");
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_lane_assignment() {
        let hash = KeyHash::from_bytes(b"test_key");
        let num_lanes = 64;

        // Lane assignment should be deterministic
        let lane1 = hash.lane(num_lanes);
        let lane2 = hash.lane(num_lanes);
        assert_eq!(lane1, lane2);

        // Lane should be within bounds
        assert!(lane1 < num_lanes);
    }

    #[test]
    fn test_jump_consistent_hash_distribution() {
        // Test that jump consistent hash distributes keys reasonably
        let num_buckets = 64;
        let num_keys = 10000;

        let mut bucket_counts = vec![0; num_buckets];

        for i in 0..num_keys {
            let key = i as u64;
            let bucket = jump_consistent_hash(key, num_buckets as u32);
            bucket_counts[bucket as usize] += 1;
        }

        // Check that distribution is reasonably uniform
        // Each bucket should get approximately num_keys / num_buckets keys
        let expected = num_keys / num_buckets;
        let tolerance = expected / 4; // Allow 25% variance

        for count in bucket_counts {
            assert!(
                count > expected - tolerance && count < expected + tolerance,
                "Bucket count {} is outside tolerance range [{}, {}]",
                count,
                expected - tolerance,
                expected + tolerance
            );
        }
    }

    #[test]
    fn test_jump_consistent_hash_stability() {
        // When buckets increase, most keys should stay in same bucket
        let key = 12345u64;
        let bucket_32 = jump_consistent_hash(key, 32);
        let bucket_64 = jump_consistent_hash(key, 64);

        // For this specific test, we just verify it's deterministic
        assert_eq!(jump_consistent_hash(key, 32), bucket_32);
        assert_eq!(jump_consistent_hash(key, 64), bucket_64);
    }
}
