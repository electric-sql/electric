//! Fault-injection layer (DISPOSABLE BRANCH ONLY — never merge to main).
//!
//! In-process failpoints at the durability-critical I/O seams, driven by the
//! `DS_FAULT` env var so a *subprocess* server can be crashed deterministically
//! and its data dir examined by the parent test:
//!
//!   DS_FAULT="<site>:<behavior>[:<arg>][,<site>:<behavior>...]"
//!
//! Sites:  wal-write | wal-fsync | ckpt-barrier | seal | data-write | tails-write
//! Behaviors:
//!   err[:N]     -> the N-th call (1-based, default 1) returns EIO
//!   short[:N]   -> (data-write only) the N-th call writes HALF the buffer then EIO
//!
//! Why this approach (investigated alternatives):
//! * tikv `fail-rs`: same idea with macros + a dep; not worth the dependency for
//!   a disposable branch, and its statics linger in release builds unless
//!   feature-gated everywhere.
//! * LD_PRELOAD syscall shims: language-agnostic but Linux-only, brittle
//!   offsets-to-sites mapping (which fsync is the committer's?), no determinism.
//! * dm-flakey / dm-error: real kernel-level injection — the gold standard for
//!   integration soak, but needs privileged Linux, is time-window (not
//!   call-site) based, and cannot express "fail exactly the 2nd checkpoint
//!   barrier".
//! * FUSE (CharybdeFS-style): expressive but heavy; poor macOS story.
//! In-process failpoints are deterministic, per-call-site, portable, and
//! compose with the existing crash-sim/e2e harness — the right tool for
//! validating *recovery decisions*; dm-flakey remains the right tool for a
//! later full-system soak.
//!
//! The fail-stop paths call `std::process::abort()` for real — validation of
//! those runs the workload in a CHILD PROCESS (re-exec of the test binary; see
//! `wal/fault_tests.rs`), asserts the abort, then recovers the child's data
//! dir in the parent and checks every acked record survived.

use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Site {
    WalWrite,
    WalFsync,
    CkptBarrier,
    Seal,
    DataWrite,
    TailsWrite,
}

#[derive(Clone, Copy, Debug)]
enum Behavior {
    Err { at: u64 },
    Short { at: u64 },
}

struct Plan {
    // site -> (behavior, call counter)
    rules: HashMap<Site, (Behavior, AtomicU64)>,
}

fn plan() -> &'static Plan {
    static PLAN: OnceLock<Plan> = OnceLock::new();
    PLAN.get_or_init(|| {
        let mut rules = HashMap::new();
        if let Ok(spec) = std::env::var("DS_FAULT") {
            for part in spec.split(',').filter(|p| !p.is_empty()) {
                let mut f = part.split(':');
                let site = match f.next().unwrap_or("") {
                    "wal-write" => Site::WalWrite,
                    "wal-fsync" => Site::WalFsync,
                    "ckpt-barrier" => Site::CkptBarrier,
                    "seal" => Site::Seal,
                    "data-write" => Site::DataWrite,
                    "tails-write" => Site::TailsWrite,
                    other => panic!("DS_FAULT: unknown site {other:?}"),
                };
                let beh = f.next().unwrap_or("err");
                let at: u64 = f.next().map(|n| n.parse().expect("DS_FAULT: bad N")).unwrap_or(1);
                let behavior = match beh {
                    "err" => Behavior::Err { at },
                    "short" => Behavior::Short { at },
                    other => panic!("DS_FAULT: unknown behavior {other:?}"),
                };
                rules.insert(site, (behavior, AtomicU64::new(0)));
            }
        }
        Plan { rules }
    })
}

/// Consult the plan at a fault site. `Ok(None)` = proceed normally;
/// `Err(e)` = inject a full failure; `Ok(Some(n))` = (data-write only) write
/// only the first `n` bytes of the buffer, then the caller must surface EIO.
pub fn check(site: Site, buf_len: usize) -> io::Result<Option<usize>> {
    let Some((behavior, counter)) = plan().rules.get(&site) else {
        return Ok(None);
    };
    let call = counter.fetch_add(1, Ordering::SeqCst) + 1;
    match *behavior {
        Behavior::Err { at } if call == at => Err(io::Error::new(
            io::ErrorKind::Other,
            format!("injected fault at {site:?} (call {call})"),
        )),
        Behavior::Short { at } if call == at => Ok(Some(buf_len / 2)),
        _ => Ok(None),
    }
}

/// True when any fault plan is active (used to gate log noise).
#[allow(dead_code)]
pub fn active() -> bool {
    !plan().rules.is_empty()
}
