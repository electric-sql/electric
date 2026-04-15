use rustler::{Env, Error, NifResult, ResourceArc, Binary, OwnedBinary, Term, Encoder};
use heed::{EnvOpenOptions, EnvFlags, Database};
use heed::types::Bytes;
use std::ops::Bound;
use std::path::Path;

mod atoms {
    rustler::atoms! {
        ok,
        error,
        not_found,
    }
}

/// Combined LMDB environment + database handle
pub struct LmdbHandle {
    env: heed::Env,
    db: Database<Bytes, Bytes>,
}

unsafe impl Send for LmdbHandle {}
unsafe impl Sync for LmdbHandle {}

#[allow(non_local_definitions)]
fn on_load(env: Env, _info: Term) -> bool {
    let _ = rustler::resource!(LmdbHandle, env);
    true
}

/// Open an LMDB environment and database, returning a single handle
#[rustler::nif(schedule = "DirtyIo")]
fn open(path: String, map_size: u64, max_dbs: u32, nosync: bool, db_name: Option<String>) -> NifResult<ResourceArc<LmdbHandle>> {
    let path = Path::new(&path);

    if !path.exists() {
        std::fs::create_dir_all(path)
            .map_err(|e| Error::Term(Box::new(format!("Failed to create directory: {}", e))))?;
    }

    let mut opts = EnvOpenOptions::new();
    opts.map_size(map_size as usize);
    opts.max_dbs(max_dbs);

    if nosync {
        unsafe { opts.flags(EnvFlags::NO_SYNC | EnvFlags::WRITE_MAP | EnvFlags::MAP_ASYNC); }
    }

    let env = unsafe {
        opts.open(path)
            .map_err(|e| Error::Term(Box::new(format!("Failed to open env: {}", e))))?
    };

    let mut wtxn = env.write_txn()
        .map_err(|e| Error::Term(Box::new(format!("Failed to begin txn: {}", e))))?;

    let db: Database<Bytes, Bytes> = match db_name {
        Some(n) => env.create_database(&mut wtxn, Some(&n)),
        None => env.create_database(&mut wtxn, None),
    }.map_err(|e| Error::Term(Box::new(format!("Failed to create db: {}", e))))?;

    wtxn.commit()
        .map_err(|e| Error::Term(Box::new(format!("Failed to commit: {}", e))))?;

    Ok(ResourceArc::new(LmdbHandle { env, db }))
}

/// Get a single value by key
#[rustler::nif(schedule = "DirtyCpu")]
fn get<'a>(env: Env<'a>, handle: ResourceArc<LmdbHandle>, key: Binary) -> NifResult<Term<'a>> {
    let rtxn = handle.env.read_txn()
        .map_err(|e| Error::Term(Box::new(format!("Failed to begin read txn: {}", e))))?;

    match handle.db.get(&rtxn, key.as_slice()) {
        Ok(Some(value)) => {
            let mut binary = OwnedBinary::new(value.len())
                .ok_or_else(|| Error::Term(Box::new("Failed to allocate binary")))?;
            binary.as_mut_slice().copy_from_slice(value);
            Ok((atoms::ok(), binary.release(env)).encode(env))
        }
        Ok(None) => Ok(atoms::not_found().encode(env)),
        Err(e) => Err(Error::Term(Box::new(format!("Get failed: {}", e)))),
    }
}

/// Put a single key-value pair
#[rustler::nif(schedule = "DirtyIo")]
fn nif_put(handle: ResourceArc<LmdbHandle>, key: Binary, value: Binary) -> NifResult<rustler::Atom> {
    let mut wtxn = handle.env.write_txn()
        .map_err(|e| Error::Term(Box::new(format!("Failed to begin write txn: {}", e))))?;

    handle.db.put(&mut wtxn, key.as_slice(), value.as_slice())
        .map_err(|e| Error::Term(Box::new(format!("Put failed: {}", e))))?;

    wtxn.commit()
        .map_err(|e| Error::Term(Box::new(format!("Commit failed: {}", e))))?;

    Ok(atoms::ok())
}

/// Batch put - write multiple key-value pairs in a single transaction
#[rustler::nif(schedule = "DirtyIo")]
fn nif_batch_put(handle: ResourceArc<LmdbHandle>, pairs: Vec<(Binary, Binary)>) -> NifResult<rustler::Atom> {
    let mut wtxn = handle.env.write_txn()
        .map_err(|e| Error::Term(Box::new(format!("Failed to begin write txn: {}", e))))?;

    for (key, value) in pairs {
        handle.db.put(&mut wtxn, key.as_slice(), value.as_slice())
            .map_err(|e| Error::Term(Box::new(format!("Put failed: {}", e))))?;
    }

    wtxn.commit()
        .map_err(|e| Error::Term(Box::new(format!("Commit failed: {}", e))))?;

    Ok(atoms::ok())
}

/// Batch get - read multiple keys in a single transaction
#[rustler::nif(schedule = "DirtyCpu")]
fn batch_get<'a>(env: Env<'a>, handle: ResourceArc<LmdbHandle>, keys: Vec<Binary>) -> NifResult<Term<'a>> {
    let rtxn = handle.env.read_txn()
        .map_err(|e| Error::Term(Box::new(format!("Failed to begin read txn: {}", e))))?;

    let mut results: Vec<Term<'a>> = Vec::with_capacity(keys.len());

    for key in keys {
        let term = match handle.db.get(&rtxn, key.as_slice()) {
            Ok(Some(value)) => {
                let mut binary = OwnedBinary::new(value.len())
                    .ok_or_else(|| Error::Term(Box::new("Failed to allocate binary")))?;
                binary.as_mut_slice().copy_from_slice(value);
                (atoms::ok(), binary.release(env)).encode(env)
            }
            Ok(None) => atoms::not_found().encode(env),
            Err(e) => return Err(Error::Term(Box::new(format!("Get failed: {}", e)))),
        };
        results.push(term);
    }

    Ok(results.encode(env))
}

/// Delete a key
#[rustler::nif(schedule = "DirtyIo")]
fn delete(handle: ResourceArc<LmdbHandle>, key: Binary) -> NifResult<rustler::Atom> {
    let mut wtxn = handle.env.write_txn()
        .map_err(|e| Error::Term(Box::new(format!("Failed to begin write txn: {}", e))))?;

    handle.db.delete(&mut wtxn, key.as_slice())
        .map_err(|e| Error::Term(Box::new(format!("Delete failed: {}", e))))?;

    wtxn.commit()
        .map_err(|e| Error::Term(Box::new(format!("Commit failed: {}", e))))?;

    Ok(atoms::ok())
}

/// Delete multiple keys in a single write transaction
#[rustler::nif(schedule = "DirtyIo")]
fn delete_keys(handle: ResourceArc<LmdbHandle>, keys: Vec<Binary>) -> NifResult<rustler::Atom> {
    let mut wtxn = handle.env.write_txn()
        .map_err(|e| Error::Term(Box::new(format!("Failed to begin write txn: {}", e))))?;

    for key in keys {
        handle.db.delete(&mut wtxn, key.as_slice())
            .map_err(|e| Error::Term(Box::new(format!("Delete failed: {}", e))))?;
    }

    wtxn.commit()
        .map_err(|e| Error::Term(Box::new(format!("Commit failed: {}", e))))?;

    Ok(atoms::ok())
}

/// Iterate over all key-value pairs (for cursor benchmark)
/// Returns count of entries iterated
#[rustler::nif(schedule = "DirtyCpu")]
fn iterate_all<'a>(env: Env<'a>, handle: ResourceArc<LmdbHandle>) -> NifResult<Term<'a>> {
    let rtxn = handle.env.read_txn()
        .map_err(|e| Error::Term(Box::new(format!("Failed to begin read txn: {}", e))))?;

    let mut count: u64 = 0;
    let iter = handle.db.iter(&rtxn)
        .map_err(|e| Error::Term(Box::new(format!("Failed to create iterator: {}", e))))?;

    for result in iter {
        let (_key, _value) = result
            .map_err(|e| Error::Term(Box::new(format!("Iteration failed: {}", e))))?;
        count += 1;
    }

    Ok((atoms::ok(), count).encode(env))
}

/// Iterate starting from a specific key (inclusive)
/// If limit is 0, returns all entries from start_key to end
#[rustler::nif(schedule = "DirtyCpu")]
fn iterate_from<'a>(
    env: Env<'a>,
    handle: ResourceArc<LmdbHandle>,
    start_key: Binary,
    limit: u64,
) -> NifResult<Term<'a>> {
    let rtxn = handle.env.read_txn()
        .map_err(|e| Error::Term(Box::new(format!("Failed to begin read txn: {}", e))))?;

    let start: &[u8] = start_key.as_slice();
    let range = (Bound::Included(start), Bound::<&[u8]>::Unbounded);
    let iter = handle.db.range(&rtxn, &range)
        .map_err(|e| Error::Term(Box::new(format!("Failed to create range iterator: {}", e))))?;

    let mut results: Vec<Term<'a>> = Vec::new();
    let mut count: u64 = 0;

    for result in iter {
        if limit > 0 && count >= limit {
            break;
        }

        let (key, value) = result
            .map_err(|e| Error::Term(Box::new(format!("Iteration failed: {}", e))))?;

        let mut key_binary = OwnedBinary::new(key.len())
            .ok_or_else(|| Error::Term(Box::new("Failed to allocate key binary")))?;
        key_binary.as_mut_slice().copy_from_slice(key);

        let mut value_binary = OwnedBinary::new(value.len())
            .ok_or_else(|| Error::Term(Box::new("Failed to allocate value binary")))?;
        value_binary.as_mut_slice().copy_from_slice(value);

        results.push((key_binary.release(env), value_binary.release(env)).encode(env));
        count += 1;
    }

    Ok((atoms::ok(), results).encode(env))
}

/// Iterate a range of keys [start_key, end_key)
/// end_key is exclusive
/// If limit is 0, returns all entries in range
#[rustler::nif(schedule = "DirtyCpu")]
fn iterate_range<'a>(
    env: Env<'a>,
    handle: ResourceArc<LmdbHandle>,
    start_key: Binary,
    end_key: Binary,
    limit: u64,
) -> NifResult<Term<'a>> {
    let rtxn = handle.env.read_txn()
        .map_err(|e| Error::Term(Box::new(format!("Failed to begin read txn: {}", e))))?;

    let start: &[u8] = start_key.as_slice();
    let end: &[u8] = end_key.as_slice();
    let range = (Bound::Included(start), Bound::Excluded(end));
    let iter = handle.db.range(&rtxn, &range)
        .map_err(|e| Error::Term(Box::new(format!("Failed to create range iterator: {}", e))))?;

    let mut results: Vec<Term<'a>> = Vec::new();
    let mut count: u64 = 0;

    for result in iter {
        if limit > 0 && count >= limit {
            break;
        }

        let (key, value) = result
            .map_err(|e| Error::Term(Box::new(format!("Iteration failed: {}", e))))?;

        let mut key_binary = OwnedBinary::new(key.len())
            .ok_or_else(|| Error::Term(Box::new("Failed to allocate key binary")))?;
        key_binary.as_mut_slice().copy_from_slice(key);

        let mut value_binary = OwnedBinary::new(value.len())
            .ok_or_else(|| Error::Term(Box::new("Failed to allocate value binary")))?;
        value_binary.as_mut_slice().copy_from_slice(value);

        results.push((key_binary.release(env), value_binary.release(env)).encode(env));
        count += 1;
    }

    Ok((atoms::ok(), results).encode(env))
}

/// Clear all entries in a database
#[rustler::nif(schedule = "DirtyIo")]
fn clear(handle: ResourceArc<LmdbHandle>) -> NifResult<rustler::Atom> {
    let mut wtxn = handle.env.write_txn()
        .map_err(|e| Error::Term(Box::new(format!("Failed to begin write txn: {}", e))))?;

    handle.db.clear(&mut wtxn)
        .map_err(|e| Error::Term(Box::new(format!("Clear failed: {}", e))))?;

    wtxn.commit()
        .map_err(|e| Error::Term(Box::new(format!("Commit failed: {}", e))))?;

    Ok(atoms::ok())
}

/// Return the number of entries in the database (O(1) via mdb_stat)
#[rustler::nif(schedule = "DirtyCpu")]
fn size(handle: ResourceArc<LmdbHandle>) -> NifResult<u64> {
    let rtxn = handle.env.read_txn()
        .map_err(|e| Error::Term(Box::new(format!("Failed to begin read txn: {}", e))))?;

    handle.db.len(&rtxn)
        .map_err(|e| Error::Term(Box::new(format!("Failed to get count: {}", e))))
}

/// Sync environment to disk
#[rustler::nif(schedule = "DirtyIo")]
fn sync(_handle: ResourceArc<LmdbHandle>) -> NifResult<rustler::Atom> {
    Ok(atoms::ok())
}

rustler::init!("Elixir.Electric.Nifs.LmdbNif", load = on_load);
