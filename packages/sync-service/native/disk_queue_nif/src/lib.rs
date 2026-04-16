use rustler::{Binary, Encoder, Env, NifResult, OwnedBinary, ResourceArc, Term};
use std::sync::Mutex;
use std::time::Duration;

mod atoms {
    rustler::atoms! {
        ok,
        error,
        empty,
        timeout,
        closed,
        invalid_commit,
    }
}

mod error;
mod meta;
mod queue;
mod record;
mod segment;

use error::QueueError;
use queue::DiskQueue;

pub struct QueueResource {
    inner: Mutex<DiskQueue>,
}

fn on_load(env: Env, _info: Term) -> bool {
    rustler::resource!(QueueResource, env);
    true
}

fn error_to_term<'a>(env: Env<'a>, err: QueueError) -> Term<'a> {
    match err {
        QueueError::Empty => (atoms::error(), atoms::empty()).encode(env),
        QueueError::Timeout => (atoms::error(), atoms::timeout()).encode(env),
        QueueError::Closed => (atoms::error(), atoms::closed()).encode(env),
        QueueError::InvalidCommit { .. } => {
            (atoms::error(), atoms::invalid_commit()).encode(env)
        }
        other => (atoms::error(), format!("{}", other)).encode(env),
    }
}

fn return_binary<'a>(env: Env<'a>, data: Vec<u8>) -> Term<'a> {
    let mut binary = match OwnedBinary::new(data.len()) {
        Some(b) => b,
        None => return (atoms::error(), "allocation_failed").encode(env),
    };
    binary.as_mut_slice().copy_from_slice(&data);
    (atoms::ok(), binary.release(env)).encode(env)
}

#[rustler::nif(schedule = "DirtyIo")]
fn nif_open<'a>(env: Env<'a>, path: String, segment_size: u64) -> Term<'a> {
    let seg_size = if segment_size == 0 {
        None
    } else {
        Some(segment_size as u32)
    };
    match DiskQueue::open(&path, seg_size) {
        Ok(q) => {
            let resource = ResourceArc::new(QueueResource {
                inner: Mutex::new(q),
            });
            (atoms::ok(), resource).encode(env)
        }
        Err(e) => error_to_term(env, e),
    }
}

#[rustler::nif(schedule = "DirtyCpu")]
fn push<'a>(env: Env<'a>, resource: ResourceArc<QueueResource>, data: Binary) -> Term<'a> {
    let mut q = resource.inner.lock().unwrap();
    match q.push(data.as_slice()) {
        Ok(seq) => (atoms::ok(), seq).encode(env),
        Err(e) => error_to_term(env, e),
    }
}

#[rustler::nif(schedule = "DirtyCpu")]
fn try_push<'a>(env: Env<'a>, resource: ResourceArc<QueueResource>, data: Binary) -> Term<'a> {
    let mut q = resource.inner.lock().unwrap();
    match q.try_push(data.as_slice()) {
        Ok(seq) => (atoms::ok(), seq).encode(env),
        Err(e) => error_to_term(env, e),
    }
}

#[rustler::nif(schedule = "DirtyCpu")]
fn pop<'a>(env: Env<'a>, resource: ResourceArc<QueueResource>) -> Term<'a> {
    let mut q = resource.inner.lock().unwrap();
    match q.pop() {
        Ok(data) => return_binary(env, data),
        Err(e) => error_to_term(env, e),
    }
}

#[rustler::nif(schedule = "DirtyCpu")]
fn pop_timeout<'a>(
    env: Env<'a>,
    resource: ResourceArc<QueueResource>,
    timeout_ms: u64,
) -> Term<'a> {
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        {
            let mut q = resource.inner.lock().unwrap();
            match q.try_pop() {
                Ok(Some(data)) => return return_binary(env, data),
                Ok(None) => {} // empty, will retry
                Err(e) => return error_to_term(env, e),
            }
        } // lock dropped here
        if std::time::Instant::now() >= deadline {
            return error_to_term(env, QueueError::Timeout);
        }
        std::thread::sleep(Duration::from_micros(100));
    }
}

#[rustler::nif(schedule = "DirtyCpu")]
fn try_pop<'a>(env: Env<'a>, resource: ResourceArc<QueueResource>) -> Term<'a> {
    let mut q = resource.inner.lock().unwrap();
    match q.try_pop() {
        Ok(Some(data)) => return_binary(env, data),
        Ok(None) => atoms::empty().encode(env),
        Err(e) => error_to_term(env, e),
    }
}

fn return_id_binary<'a>(env: Env<'a>, id: u64, data: Vec<u8>) -> Term<'a> {
    let mut binary = match OwnedBinary::new(data.len()) {
        Some(b) => b,
        None => return (atoms::error(), "allocation_failed").encode(env),
    };
    binary.as_mut_slice().copy_from_slice(&data);
    (atoms::ok(), (id, binary.release(env))).encode(env)
}

fn return_id_binary_list<'a>(env: Env<'a>, records: Vec<(u64, Vec<u8>)>) -> Term<'a> {
    let mut tuples: Vec<Term<'a>> = Vec::with_capacity(records.len());
    for (id, data) in records {
        let mut binary = match OwnedBinary::new(data.len()) {
            Some(b) => b,
            None => return (atoms::error(), "allocation_failed").encode(env),
        };
        binary.as_mut_slice().copy_from_slice(&data);
        tuples.push((id, binary.release(env)).encode(env));
    }
    (atoms::ok(), tuples).encode(env)
}

#[rustler::nif(schedule = "DirtyCpu")]
fn peek<'a>(env: Env<'a>, resource: ResourceArc<QueueResource>) -> Term<'a> {
    let mut q = resource.inner.lock().unwrap();
    match q.peek() {
        Ok(Some((id, data))) => return_id_binary(env, id, data),
        Ok(None) => atoms::empty().encode(env),
        Err(e) => error_to_term(env, e),
    }
}

#[rustler::nif(schedule = "DirtyCpu")]
fn peek_n<'a>(env: Env<'a>, resource: ResourceArc<QueueResource>, n: usize) -> Term<'a> {
    let mut q = resource.inner.lock().unwrap();
    match q.peek_n(n) {
        Ok(records) => return_id_binary_list(env, records),
        Err(e) => error_to_term(env, e),
    }
}

#[rustler::nif(schedule = "DirtyCpu")]
fn peek_after<'a>(
    env: Env<'a>,
    resource: ResourceArc<QueueResource>,
    after_id: u64,
) -> Term<'a> {
    let mut q = resource.inner.lock().unwrap();
    match q.peek_after(after_id) {
        Ok(records) => return_id_binary_list(env, records),
        Err(e) => error_to_term(env, e),
    }
}

#[rustler::nif(schedule = "DirtyCpu")]
fn commit<'a>(env: Env<'a>, resource: ResourceArc<QueueResource>) -> Term<'a> {
    let mut q = resource.inner.lock().unwrap();
    match q.commit() {
        Ok(()) => atoms::ok().encode(env),
        Err(e) => error_to_term(env, e),
    }
}

#[rustler::nif(schedule = "DirtyCpu")]
fn commit_n<'a>(env: Env<'a>, resource: ResourceArc<QueueResource>, n: usize) -> Term<'a> {
    let mut q = resource.inner.lock().unwrap();
    match q.commit_n(n) {
        Ok(()) => atoms::ok().encode(env),
        Err(e) => error_to_term(env, e),
    }
}

#[rustler::nif(schedule = "DirtyCpu")]
fn rewind_peek<'a>(env: Env<'a>, resource: ResourceArc<QueueResource>) -> Term<'a> {
    let mut q = resource.inner.lock().unwrap();
    match q.rewind_peek() {
        Ok(()) => atoms::ok().encode(env),
        Err(e) => error_to_term(env, e),
    }
}

#[rustler::nif]
fn size(resource: ResourceArc<QueueResource>) -> u64 {
    let q = resource.inner.lock().unwrap();
    q.size()
}

#[rustler::nif]
fn is_empty(resource: ResourceArc<QueueResource>) -> bool {
    let q = resource.inner.lock().unwrap();
    q.is_empty()
}

#[rustler::nif]
fn close(resource: ResourceArc<QueueResource>) -> rustler::Atom {
    let q = resource.inner.lock().unwrap();
    q.close();
    atoms::ok()
}

rustler::init!(
    "Elixir.Electric.Nifs.DiskQueue",
    load = on_load
);
