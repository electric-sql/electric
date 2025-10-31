/// Criterion benchmarks for LSM index components
///
/// Run with: cargo bench

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use lsm_index_nif::*;

fn bench_hash(c: &mut Criterion) {
    c.bench_function("hash/from_bytes", |b| {
        let key = b"test_key_12345";
        b.iter(|| {
            let hash = KeyHash::from_bytes(black_box(key));
            black_box(hash);
        });
    });

    c.bench_function("hash/lane_assignment", |b| {
        let hash = KeyHash::from_bytes(b"test_key");
        b.iter(|| {
            let lane = hash.lane(black_box(64));
            black_box(lane);
        });
    });
}

fn bench_overlay(c: &mut Criterion) {
    let mut group = c.benchmark_group("overlay");

    for size in [100, 1_000, 10_000] {
        group.bench_with_input(BenchmarkId::new("insert", size), &size, |b, &size| {
            b.iter(|| {
                let mut overlay = Overlay::new();
                for i in 0..size {
                    let key = format!("key{}", i);
                    let hash = KeyHash::from_bytes(key.as_bytes());
                    overlay.insert(hash, i as u32);
                }
                black_box(overlay);
            });
        });

        group.bench_with_input(BenchmarkId::new("lookup", size), &size, |b, &size| {
            let mut overlay = Overlay::new();
            for i in 0..size {
                let key = format!("key{}", i);
                let hash = KeyHash::from_bytes(key.as_bytes());
                overlay.insert(hash, i as u32);
            }

            b.iter(|| {
                let key = format!("key{}", size / 2);
                let hash = KeyHash::from_bytes(key.as_bytes());
                let result = overlay.lookup(hash);
                black_box(result);
            });
        });
    }

    group.finish();
}

fn bench_lane(c: &mut Criterion) {
    let mut group = c.benchmark_group("lane");

    group.bench_function("insert_hot_path", |b| {
        let mut lane = Lane::new(0);
        let hash = KeyHash::from_bytes(b"test_key");

        b.iter(|| {
            lane.insert(black_box(hash), black_box(1));
        });
    });

    group.bench_function("lookup_overlay_only", |b| {
        let mut lane = Lane::new(0);
        let hash = KeyHash::from_bytes(b"test_key");
        lane.insert(hash, 1);

        b.iter(|| {
            let result = lane.lookup(black_box(hash));
            black_box(result);
        });
    });

    group.bench_function("lookup_with_segments", |b| {
        let mut lane = Lane::new(0);

        // Add entries and compact to create segments
        for i in 0..1000 {
            let key = format!("key{}", i);
            let hash = KeyHash::from_bytes(key.as_bytes());
            lane.insert(hash, i as u32);
        }
        lane.compact().unwrap();

        // Add more to overlay
        for i in 1000..1100 {
            let key = format!("key{}", i);
            let hash = KeyHash::from_bytes(key.as_bytes());
            lane.insert(hash, i as u32);
        }

        let test_hash = KeyHash::from_bytes(b"key500");

        b.iter(|| {
            let result = lane.lookup(black_box(test_hash));
            black_box(result);
        });
    });

    group.bench_function("compaction", |b| {
        b.iter(|| {
            let mut lane = Lane::new(0);

            // Fill overlay
            for i in 0..10_000 {
                let key = format!("key{}", i);
                let hash = KeyHash::from_bytes(key.as_bytes());
                lane.insert(hash, i as u32);
            }

            // Compact
            lane.compact().unwrap();
            black_box(lane);
        });
    });

    group.finish();
}

fn bench_lsm_index(c: &mut Criterion) {
    let mut group = c.benchmark_group("lsm_index");

    group.bench_function("insert_distributed", |b| {
        let index = LsmIndex::new(64, None);

        b.iter(|| {
            for i in 0..1000 {
                let key = format!("key{}", i);
                index.insert(key.as_bytes(), i as u32).unwrap();
            }
        });
    });

    group.bench_function("lookup_distributed", |b| {
        let index = LsmIndex::new(64, None);

        // Populate index
        for i in 0..10_000 {
            let key = format!("key{}", i);
            index.insert(key.as_bytes(), i as u32).unwrap();
        }

        b.iter(|| {
            let key = b"key5000";
            let result = index.lookup(black_box(key));
            black_box(result);
        });
    });

    group.bench_function("lookup_with_compaction", |b| {
        let index = LsmIndex::new(64, None);

        // Populate and compact
        for i in 0..50_000 {
            let key = format!("key{}", i);
            index.insert(key.as_bytes(), i as u32).unwrap();
        }
        index.maybe_compact(10_000).unwrap();

        b.iter(|| {
            let key = b"key25000";
            let result = index.lookup(black_box(key));
            black_box(result);
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_hash,
    bench_overlay,
    bench_lane,
    bench_lsm_index
);
criterion_main!(benches);
