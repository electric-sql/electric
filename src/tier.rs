// Hot/cold tiering: fixed-size sealed segments + a per-stream manifest.
//
// This module is ALWAYS compiled, but is INACTIVE unless tiering is enabled at
// runtime (`--tier s3|local`). With tiering off (the default) no stream ever
// seals, the manifest stays empty, and the read/append paths behave exactly as
// the single-contiguous-file server always has — byte-for-byte unchanged. The
// only feature-gated piece is the S3 `BlobStore` adapter (see `blobstore.rs`);
// everything here is plain Rust with no heavy dependencies.
//
// Design (mirrors the stratovolt Cloudflare Worker model, ported to fd-backed
// storage):
//   - A stream's live tail lives in its contiguous data file, exactly as today.
//   - When the unsealed tail crosses `segment_bytes` (default 8 MiB), the prefix
//     up to a safe boundary is sealed into an immutable, CDN-friendly *segment*.
//     For JSON streams the boundary must land on a value boundary (a top-level
//     `,` that is not inside a string) so a sealed segment is independently
//     wrappable as `[ … ]` — ported from stratovolt's `findNthJsonValueEnd`.
//   - A sealed segment is copied to a separate chunk file on disk, then (when a
//     remote tier is configured) offloaded to object storage. Once the upload is
//     verified and the manifest entry is durably flipped to `Remote`, the local
//     chunk file is `unlink`ed — safe even with in-flight reads, since Unix keeps
//     an open fd readable after unlink.
//   - The manifest is an ordered list of sealed segments plus a contiguous
//     `sealed_offset` watermark; logical offsets below it resolve to a segment
//     (Local fd or Remote key), at/above it to the live data file.

use std::path::PathBuf;
use std::sync::Mutex;

/// Default seal boundary: 8 MiB. A CDN-friendly immutable object size — large
/// enough to amortise per-object overhead, small enough to cache and range-read.
pub const DEFAULT_SEGMENT_BYTES: u64 = 8 * 1024 * 1024;

/// Where a sealed segment's bytes currently live.
#[derive(Clone, Debug)]
pub enum Placement {
    /// A separate immutable chunk file on local disk (path).
    Local(PathBuf),
    /// An object in the configured BlobStore (key).
    Remote(String),
}

/// One immutable sealed segment of a stream. `logical_start` is the stream-wide
/// logical offset where the segment begins; `len` is its byte length. Segments
/// are contiguous and ordered: `segments[i].logical_start + segments[i].len ==
/// segments[i+1].logical_start`, and the first starts at the stream's
/// `base_offset` (0 for roots; the fork point for forks — fork inheritance below
/// `base_offset` still resolves through the parent chain, unchanged).
#[derive(Clone, Debug)]
pub struct SegmentEntry {
    pub logical_start: u64,
    pub len: u64,
    pub placement: Placement,
    /// True once the bytes are durably in the remote tier (mirrors `placement`
    /// being `Remote`; kept for clarity / recovery reconciliation).
    pub remote: bool,
}

impl SegmentEntry {
    pub fn logical_end(&self) -> u64 {
        self.logical_start + self.len
    }
}

/// Per-stream sealing/offload manifest. Lives in `StreamState` behind a Mutex
/// and is persisted in the `.meta` sidecar. Empty (and untouched) when tiering
/// is off.
#[derive(Default)]
pub struct Manifest {
    pub segments: Vec<SegmentEntry>,
    /// Contiguous watermark: every byte in `[base_offset, sealed_offset)` is
    /// covered by a sealed segment. Bytes at/above it are still in the live data
    /// file. (Stored absolute/logical, not file-local.)
    pub sealed_offset: u64,
    /// True while an offload pass is in flight, so we never launch two at once.
    pub offloading: bool,
}

// ---------------- JSON value-boundary scanning ----------------
//
// Ported from stratovolt `findNthJsonValueEnd` (buffer-utils.ts). The data file
// for a JSON stream is the contiguous wire form `value1,value2,value3,` (every
// value followed by a `,`). To seal a prefix we must cut on a top-level comma
// that is NOT inside a JSON string and NOT inside a nested object/array — so the
// sealed segment is a whole number of values and can be wrapped `[ … ]`.

const QUOTE: u8 = b'"';
const BACKSLASH: u8 = b'\\';
const OPEN_BRACE: u8 = b'{';
const CLOSE_BRACE: u8 = b'}';
const OPEN_BRACKET: u8 = b'[';
const CLOSE_BRACKET: u8 = b']';
const COMMA: u8 = b',';

/// Given the contiguous JSON wire bytes `data` (`value,value,…,`), return the
/// largest cut length `k <= limit` such that `data[..k]` ends exactly on a
/// top-level value separator (`,`) — i.e. a whole number of values. Returns 0 if
/// no such boundary exists at or before `limit` (e.g. a single value larger than
/// `limit`, in which case the caller should wait for it to complete rather than
/// split mid-value).
///
/// The scan is a byte-level state machine that ignores commas/brackets/braces
/// inside JSON strings and honours backslash escapes, exactly like stratovolt's
/// boundary finder. It tracks the last in-bounds top-level comma seen.
pub fn last_json_value_boundary(data: &[u8], limit: u64) -> u64 {
    let limit = (limit as usize).min(data.len());
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escape = false;
    let mut last_boundary: usize = 0;
    let mut pos = 0usize;
    while pos < data.len() {
        let b = data[pos];
        if escape {
            escape = false;
            pos += 1;
            continue;
        }
        if in_string {
            if b == BACKSLASH {
                escape = true;
            } else if b == QUOTE {
                in_string = false;
            }
            pos += 1;
            continue;
        }
        match b {
            QUOTE => in_string = true,
            OPEN_BRACE | OPEN_BRACKET => depth += 1,
            CLOSE_BRACE | CLOSE_BRACKET => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            COMMA if depth == 0 => {
                // `data[..pos+1]` ends just past this top-level comma — a clean
                // value boundary. Record it if still within the limit.
                let boundary = pos + 1;
                if boundary <= limit {
                    last_boundary = boundary;
                } else {
                    // We've passed the limit; no further in-bounds boundary can
                    // be larger, so stop.
                    break;
                }
            }
            _ => {}
        }
        pos += 1;
    }
    last_boundary as u64
}

// ---------------- runtime tiering config ----------------

/// Tier backend selection.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TierKind {
    Off,
    /// Local-filesystem BlobStore (a chunk directory) — for testing offload
    /// without S3.
    Local,
    /// S3-compatible object storage (feature `tier`).
    S3,
}

/// Parsed tiering configuration, built from CLI flags + env in main.rs and held
/// by the Store. When `kind == Off`, nothing seals and this is inert.
#[derive(Clone, Debug)]
pub struct TierConfig {
    pub kind: TierKind,
    pub segment_bytes: u64,
    pub key_prefix: String,
    // S3 connection (only meaningful when kind == S3).
    pub endpoint: Option<String>,
    pub region: Option<String>,
    pub bucket: Option<String>,
    pub path_style: bool,
    pub allow_http: bool,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    /// Directory for the local BlobStore (kind == Local) and for staged sealed
    /// chunk files before offload (all kinds). Defaults to `<data_dir>/cold`.
    pub local_dir: Option<PathBuf>,
}

impl Default for TierConfig {
    fn default() -> Self {
        TierConfig {
            kind: TierKind::Off,
            segment_bytes: DEFAULT_SEGMENT_BYTES,
            key_prefix: String::new(),
            endpoint: None,
            region: None,
            bucket: None,
            path_style: true,
            allow_http: false,
            access_key_id: None,
            secret_access_key: None,
            local_dir: None,
        }
    }
}

impl TierConfig {
    pub fn enabled(&self) -> bool {
        self.kind != TierKind::Off
    }
}

/// Stream-level sealing state, kept inside `StreamState` (always present; only
/// mutated when tiering is enabled). Behind a Mutex so the offload background
/// task and the append path coordinate.
pub struct TierState {
    pub manifest: Mutex<Manifest>,
}

impl Default for TierState {
    fn default() -> Self {
        TierState {
            manifest: Mutex::new(Manifest::default()),
        }
    }
}

impl TierState {
    /// Rebuild a TierState from persisted manifest entries. `segments_dir` is
    /// where local chunk files live (used to reconstruct `Local` paths).
    pub fn from_meta(
        metas: &[crate::store::MetaSegment],
        sealed_offset: u64,
        segments_dir: &std::path::Path,
    ) -> TierState {
        let segments = metas
            .iter()
            .map(|m| {
                let (placement, remote) = match (&m.remote_key, &m.local_file) {
                    (Some(key), _) => (Placement::Remote(key.clone()), true),
                    (None, Some(name)) => (Placement::Local(segments_dir.join(name)), false),
                    // Corrupt entry (neither) — treat as a missing local file so
                    // reconcile flags it; keep a placeholder path.
                    (None, None) => (Placement::Local(segments_dir.join("__missing__")), false),
                };
                SegmentEntry {
                    logical_start: m.logical_start,
                    len: m.len,
                    placement,
                    remote,
                }
            })
            .collect();
        TierState {
            manifest: Mutex::new(Manifest {
                segments,
                sealed_offset,
                offloading: false,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundary_simple_values() {
        // value,value,value,  (positions of the commas: 1,3,5)
        let data = b"1,2,3,";
        assert_eq!(last_json_value_boundary(data, 6), 6); // after final comma
        assert_eq!(last_json_value_boundary(data, 5), 4); // "1,2," — last comma <=5 is at idx3 -> 4
        assert_eq!(last_json_value_boundary(data, 4), 4);
        assert_eq!(last_json_value_boundary(data, 3), 2); // "1,"
        assert_eq!(last_json_value_boundary(data, 1), 0); // mid "1" -> no boundary
    }

    #[test]
    fn ignores_commas_inside_strings() {
        // "a,b" then ,  — the comma inside the string must NOT be a boundary.
        let data = br#""a,b",2,"#;
        // first top-level comma is at index 5 (after the closing quote)
        assert_eq!(last_json_value_boundary(data, 8), 8);
        assert_eq!(last_json_value_boundary(data, 6), 6); // "\"a,b\","
        assert_eq!(last_json_value_boundary(data, 4), 0); // still inside the string
    }

    #[test]
    fn ignores_escaped_quotes() {
        // "he said \"hi\"" , 2 ,
        let data = br#""he said \"hi\"",2,"#;
        // The escaped quotes do not close the string; first real boundary is the
        // comma after the closing quote.
        let first = last_json_value_boundary(data, data.len() as u64);
        assert_eq!(first, data.len() as u64);
        // A cut in the middle of the string yields no boundary.
        assert_eq!(last_json_value_boundary(data, 10), 0);
    }

    #[test]
    fn ignores_nested_brackets_and_braces() {
        // {"k":[1,2,{"n":3}]},42,
        let data = br#"{"k":[1,2,{"n":3}]},42,"#;
        // The only top-level commas are after the object and after 42.
        let n = data.len();
        assert_eq!(last_json_value_boundary(data, n as u64), n as u64);
        // cut at 19 -> just past the closing '}' of the object, before its comma
        // -> the boundary is the comma at index 19 => 20.
        assert_eq!(last_json_value_boundary(data, 20), 20);
        // cut at 19 -> last top-level comma <=19 is none (object not yet closed
        // by comma) => 0.
        assert_eq!(last_json_value_boundary(data, 19), 0);
    }

    #[test]
    fn single_huge_value_no_boundary() {
        let data = br#"{"big":"xxxxxxxxxxxxxxxxxxxx"},"#;
        // limit before the trailing comma -> no boundary (don't split mid-value).
        assert_eq!(last_json_value_boundary(data, 10), 0);
        // full -> boundary at the end.
        assert_eq!(
            last_json_value_boundary(data, data.len() as u64),
            data.len() as u64
        );
    }

    #[test]
    fn empty_input() {
        assert_eq!(last_json_value_boundary(b"", 0), 0);
        assert_eq!(last_json_value_boundary(b"", 10), 0);
    }
}
