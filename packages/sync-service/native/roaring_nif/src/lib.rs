use roaring::RoaringBitmap;
use rustler::{Env, NifResult, ResourceArc, Term};
use std::sync::RwLock;

// Resource wrapper for RoaringBitmap
pub struct BitmapResource {
    bitmap: RwLock<RoaringBitmap>,
}

// Initialize the NIF with inline resource registration to avoid non-local impl warning
rustler::init!(
    "Elixir.Electric.Shapes.RoaringBitmap",
    load = |env, _| { rustler::resource!(BitmapResource, env) }
);

// Create a new empty bitmap
#[rustler::nif]
fn new() -> NifResult<ResourceArc<BitmapResource>> {
    let bitmap = RoaringBitmap::new();
    Ok(ResourceArc::new(BitmapResource {
        bitmap: RwLock::new(bitmap),
    }))
}

// Create a bitmap from a list of integers
#[rustler::nif]
fn from_list(values: Vec<u32>) -> NifResult<ResourceArc<BitmapResource>> {
    let bitmap = RoaringBitmap::from_iter(values);
    Ok(ResourceArc::new(BitmapResource {
        bitmap: RwLock::new(bitmap),
    }))
}

// Add a value to the bitmap
#[rustler::nif]
fn add(resource: ResourceArc<BitmapResource>, value: u32) -> NifResult<ResourceArc<BitmapResource>> {
    let mut bitmap = resource.bitmap.write().unwrap().clone();
    bitmap.insert(value);
    Ok(ResourceArc::new(BitmapResource {
        bitmap: RwLock::new(bitmap),
    }))
}

// Remove a value from the bitmap
#[rustler::nif]
fn remove(resource: ResourceArc<BitmapResource>, value: u32) -> NifResult<ResourceArc<BitmapResource>> {
    let mut bitmap = resource.bitmap.write().unwrap().clone();
    bitmap.remove(value);
    Ok(ResourceArc::new(BitmapResource {
        bitmap: RwLock::new(bitmap),
    }))
}

// Check if bitmap contains a value
#[rustler::nif]
fn contains(resource: ResourceArc<BitmapResource>, value: u32) -> NifResult<bool> {
    let bitmap = resource.bitmap.read().unwrap();
    Ok(bitmap.contains(value))
}

// Union of two bitmaps
#[rustler::nif]
fn union(
    resource1: ResourceArc<BitmapResource>,
    resource2: ResourceArc<BitmapResource>,
) -> NifResult<ResourceArc<BitmapResource>> {
    let bitmap1 = resource1.bitmap.read().unwrap();
    let bitmap2 = resource2.bitmap.read().unwrap();
    let result = &*bitmap1 | &*bitmap2;
    Ok(ResourceArc::new(BitmapResource {
        bitmap: RwLock::new(result),
    }))
}

// Intersection of two bitmaps
#[rustler::nif]
fn intersection(
    resource1: ResourceArc<BitmapResource>,
    resource2: ResourceArc<BitmapResource>,
) -> NifResult<ResourceArc<BitmapResource>> {
    let bitmap1 = resource1.bitmap.read().unwrap();
    let bitmap2 = resource2.bitmap.read().unwrap();
    let result = &*bitmap1 & &*bitmap2;
    Ok(ResourceArc::new(BitmapResource {
        bitmap: RwLock::new(result),
    }))
}

// Difference of two bitmaps (elements in first but not in second)
#[rustler::nif]
fn difference(
    resource1: ResourceArc<BitmapResource>,
    resource2: ResourceArc<BitmapResource>,
) -> NifResult<ResourceArc<BitmapResource>> {
    let bitmap1 = resource1.bitmap.read().unwrap();
    let bitmap2 = resource2.bitmap.read().unwrap();
    let result = bitmap1.clone() - &*bitmap2;
    Ok(ResourceArc::new(BitmapResource {
        bitmap: RwLock::new(result),
    }))
}

// Get the cardinality (number of elements) in the bitmap
#[rustler::nif]
fn cardinality(resource: ResourceArc<BitmapResource>) -> NifResult<u64> {
    let bitmap = resource.bitmap.read().unwrap();
    Ok(bitmap.len())
}

// Check if bitmap is empty
#[rustler::nif]
fn is_empty(resource: ResourceArc<BitmapResource>) -> NifResult<bool> {
    let bitmap = resource.bitmap.read().unwrap();
    Ok(bitmap.is_empty())
}

// Convert bitmap to list
#[rustler::nif]
fn to_list(resource: ResourceArc<BitmapResource>) -> NifResult<Vec<u32>> {
    let bitmap = resource.bitmap.read().unwrap();
    Ok(bitmap.iter().collect())
}

// Clear all elements from the bitmap
#[rustler::nif]
fn clear(_resource: ResourceArc<BitmapResource>) -> NifResult<ResourceArc<BitmapResource>> {
    Ok(ResourceArc::new(BitmapResource {
        bitmap: RwLock::new(RoaringBitmap::new()),
    }))
}

// Check if two bitmaps are equal
#[rustler::nif]
fn equal(
    resource1: ResourceArc<BitmapResource>,
    resource2: ResourceArc<BitmapResource>,
) -> NifResult<bool> {
    let bitmap1 = resource1.bitmap.read().unwrap();
    let bitmap2 = resource2.bitmap.read().unwrap();
    Ok(*bitmap1 == *bitmap2)
}

// Check if first bitmap is a subset of second
#[rustler::nif]
fn is_subset(
    resource1: ResourceArc<BitmapResource>,
    resource2: ResourceArc<BitmapResource>,
) -> NifResult<bool> {
    let bitmap1 = resource1.bitmap.read().unwrap();
    let bitmap2 = resource2.bitmap.read().unwrap();
    Ok(bitmap1.is_subset(&*bitmap2))
}

// Batch add multiple values to a bitmap
#[rustler::nif]
fn add_many(
    resource: ResourceArc<BitmapResource>,
    values: Vec<u32>,
) -> NifResult<ResourceArc<BitmapResource>> {
    let mut bitmap = resource.bitmap.write().unwrap().clone();
    for value in values {
        bitmap.insert(value);
    }
    Ok(ResourceArc::new(BitmapResource {
        bitmap: RwLock::new(bitmap),
    }))
}

// Union multiple bitmaps at once (bulk operation)
#[rustler::nif]
fn union_many(bitmaps: Vec<ResourceArc<BitmapResource>>) -> NifResult<ResourceArc<BitmapResource>> {
    let mut result = RoaringBitmap::new();
    for bitmap_resource in bitmaps {
        let bitmap = bitmap_resource.bitmap.read().unwrap();
        result |= &*bitmap;
    }
    Ok(ResourceArc::new(BitmapResource {
        bitmap: RwLock::new(result),
    }))
}

// Intersection of multiple bitmaps at once (bulk operation)
#[rustler::nif]
fn intersection_many(
    bitmaps: Vec<ResourceArc<BitmapResource>>,
) -> NifResult<ResourceArc<BitmapResource>> {
    if bitmaps.is_empty() {
        return Ok(ResourceArc::new(BitmapResource {
            bitmap: RwLock::new(RoaringBitmap::new()),
        }));
    }

    let mut result = bitmaps[0].bitmap.read().unwrap().clone();
    for bitmap_resource in &bitmaps[1..] {
        let bitmap = bitmap_resource.bitmap.read().unwrap();
        result &= &*bitmap;
    }
    Ok(ResourceArc::new(BitmapResource {
        bitmap: RwLock::new(result),
    }))
}

// Fast check if any bitmap in list contains value (early exit on first match)
#[rustler::nif]
fn any_contains(bitmaps: Vec<ResourceArc<BitmapResource>>, value: u32) -> NifResult<bool> {
    for bitmap_resource in bitmaps {
        let bitmap = bitmap_resource.bitmap.read().unwrap();
        if bitmap.contains(value) {
            return Ok(true);
        }
    }
    Ok(false)
}

// Get the minimum value in the bitmap
#[rustler::nif]
fn min(resource: ResourceArc<BitmapResource>) -> NifResult<Option<u32>> {
    let bitmap = resource.bitmap.read().unwrap();
    Ok(bitmap.min())
}

// Get the maximum value in the bitmap
#[rustler::nif]
fn max(resource: ResourceArc<BitmapResource>) -> NifResult<Option<u32>> {
    let bitmap = resource.bitmap.read().unwrap();
    Ok(bitmap.max())
}
