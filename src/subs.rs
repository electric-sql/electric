// __ds control plane: subscriptions (webhook + pull-wake) per PROTOCOL.md.
//
// In-memory subscription registry (not persisted across restarts). Webhook
// notifications are signed with a per-process Ed25519 key published at
// {root}/__ds/jwks.json; delivery uses a minimal HTTP/1.1 client (http only —
// production deployments should front TLS with a proxy).

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::api::{Body, Method, Req, Resp};
use crate::store::{format_offset, Store};

// ---------------- small utilities ----------------

use crate::api::{base64_encode, BASE64_URL};

fn b64url(data: &[u8]) -> String {
    base64_encode(data, BASE64_URL, false)
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .expect("read /dev/urandom");
    buf
}

fn random_id(prefix: &str) -> String {
    format!("{prefix}{}", b64url(&random_bytes::<12>()))
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// RFC 3339 from unix seconds (civil-from-days, Howard Hinnant).
fn rfc3339(secs: u64) -> String {
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Glob match: `*` = exactly one path segment, `**` = zero or more.
fn glob_match(pattern: &str, path: &str) -> bool {
    fn rec(pat: &[&str], path: &[&str]) -> bool {
        match (pat.first(), path.first()) {
            (None, None) => true,
            (Some(&"**"), _) => {
                rec(&pat[1..], path) || (!path.is_empty() && rec(pat, &path[1..]))
            }
            (Some(&"*"), Some(_)) => rec(&pat[1..], &path[1..]),
            (Some(p), Some(s)) if *p == *s => rec(&pat[1..], &path[1..]),
            _ => false,
        }
    }
    let pat: Vec<&str> = pattern.split('/').collect();
    let segs: Vec<&str> = path.split('/').collect();
    rec(&pat, &segs)
}

// ---------------- minimal HTTP client (webhook delivery, http only) ----------------

async fn http_post_json(url: &str, sig_header: &str, body: &[u8]) -> Option<(u16, Vec<u8>)> {
    let rest = url.strip_prefix("http://")?;
    let (hostport, path) = match rest.split_once('/') {
        Some((h, p)) => (h, format!("/{p}")),
        None => (rest, "/".to_string()),
    };
    let addr = if hostport.contains(':') {
        hostport.to_string()
    } else {
        format!("{hostport}:80")
    };
    let mut stream = tokio::net::TcpStream::connect(&addr).await.ok()?;
    let req = format!(
        "POST {path} HTTP/1.1\r\nhost: {hostport}\r\ncontent-type: application/json\r\nwebhook-signature: {sig_header}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(req.as_bytes()).await.ok()?;
    stream.write_all(body).await.ok()?;
    let mut raw = Vec::with_capacity(4096);
    stream.read_to_end(&mut raw).await.ok()?;
    let mut headers = [httparse::EMPTY_HEADER; 32];
    let mut resp = httparse::Response::new(&mut headers);
    let n = match resp.parse(&raw) {
        Ok(httparse::Status::Complete(n)) => n,
        _ => return None,
    };
    let chunked = resp.headers.iter().any(|h| {
        h.name.eq_ignore_ascii_case("transfer-encoding")
            && String::from_utf8_lossy(h.value)
                .to_ascii_lowercase()
                .contains("chunked")
    });
    let body = if chunked {
        decode_chunked(&raw[n..])?
    } else {
        raw[n..].to_vec()
    };
    Some((resp.code?, body))
}

fn decode_chunked(mut raw: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(raw.len());
    loop {
        let pos = raw.windows(2).position(|w| w == b"\r\n")?;
        let size = usize::from_str_radix(
            std::str::from_utf8(&raw[..pos]).ok()?.split(';').next()?.trim(),
            16,
        )
        .ok()?;
        raw = &raw[pos + 2..];
        if size == 0 {
            return Some(out);
        }
        // Need `size` data bytes + trailing CRLF; checked_add guards a hostile
        // size, and the bound prevents slicing past a truncated response.
        let end = match size.checked_add(2) {
            Some(e) if raw.len() >= e => e,
            _ => return None,
        };
        out.extend_from_slice(&raw[..size]);
        raw = &raw[end..];
    }
}

// ---------------- subscription state ----------------

#[derive(Clone, PartialEq)]
enum Kind {
    Webhook { url: String },
    PullWake { wake_stream: String },
}

#[derive(Clone)]
struct Link {
    explicit: bool,
    acked: String,
}

struct Wake {
    wake_id: String,
    token: String,
    holder: Option<String>,
    deadline: Instant,
}

struct Sub {
    id: String,
    root: String, // path prefix before /__ds (e.g. "/v1/stream")
    host: String, // Host header at creation, for absolute URLs
    kind: Kind,
    pattern: Option<String>,
    explicit_streams: Vec<String>,
    lease_ttl_ms: u64,
    description: Option<String>,
    links: BTreeMap<String, Link>,
    generation: u64,
    wake: Option<Wake>,
    /// Activity arrived while a wake was in flight.
    pending: bool,
    created_at: String,
}

pub struct SubsManager {
    signing: SigningKey,
    kid: String,
    subs: Mutex<HashMap<String, Sub>>,
}

impl Default for SubsManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SubsManager {
    pub fn new() -> SubsManager {
        let signing = SigningKey::from_bytes(&random_bytes::<32>());
        let pubkey = signing.verifying_key().to_bytes();
        let kid = format!("ds_{}", b64url(&pubkey[..8]));
        SubsManager {
            signing,
            kid,
            subs: Mutex::new(HashMap::new()),
        }
    }

    fn jwks(&self) -> Value {
        json!({
            "keys": [{
                "kty": "OKP",
                "crv": "Ed25519",
                "kid": self.kid,
                "use": "sig",
                "alg": "EdDSA",
                "x": b64url(&self.signing.verifying_key().to_bytes()),
            }]
        })
    }

    fn sign(&self, body: &[u8]) -> String {
        let t = unix_now();
        let mut msg = Vec::with_capacity(body.len() + 12);
        msg.extend_from_slice(t.to_string().as_bytes());
        msg.push(b'.');
        msg.extend_from_slice(body);
        let sig = self.signing.sign(&msg);
        format!("t={t},kid={},ed25519={}", self.kid, b64url(&sig.to_bytes()))
    }
}

fn sub_json(sub: &Sub) -> Value {
    let streams: Vec<Value> = sub
        .links
        .iter()
        .map(|(path, link)| {
            json!({
                "path": path,
                "link_type": if link.explicit { "explicit" } else { "glob" },
                "acked_offset": link.acked,
            })
        })
        .collect();
    let mut v = json!({
        "id": sub.id,
        "type": match &sub.kind { Kind::Webhook{..} => "webhook", Kind::PullWake{..} => "pull-wake" },
        "streams": streams,
        "lease_ttl_ms": sub.lease_ttl_ms,
        "created_at": sub.created_at,
        "status": "active",
    });
    if let Some(p) = &sub.pattern {
        v["pattern"] = json!(p);
    }
    if let Some(d) = &sub.description {
        v["description"] = json!(d);
    }
    match &sub.kind {
        Kind::Webhook { url } => {
            v["webhook"] = json!({
                "url": url,
                "signing": {
                    "alg": "ed25519",
                    "kid": "", // filled by caller (needs manager)
                    "jwks_url": format!("http://{}{}/__ds/jwks.json", sub.host, sub.root),
                },
            });
        }
        Kind::PullWake { wake_stream } => {
            v["wake_stream"] = json!(wake_stream);
        }
    }
    v
}

// ---------------- helpers shared with handlers ----------------

fn json_response(status: u16, v: &Value) -> Resp {
    let mut r = Resp::new(status);
    r.headers
        .push(("content-type", "application/json".to_string()));
    r.body = Body::Full(Bytes::from(serde_json::to_vec(v).unwrap()));
    r
}

fn error_response(status: u16, code: &str, extra: Option<Value>) -> Resp {
    let mut err = json!({ "code": code });
    if let Some(Value::Object(map)) = extra {
        for (k, v) in map {
            err[k] = v;
        }
    }
    json_response(status, &json!({ "error": err }))
}

fn rel_path<'a>(root: &str, full: &'a str) -> Option<&'a str> {
    full.strip_prefix(root)
        .map(|s| s.trim_start_matches('/'))
        .filter(|s| !s.is_empty())
}

fn stream_tail(store: &Store, root: &str, rel: &str) -> String {
    match store.get(&format!("{root}/{rel}")) {
        Some(st) => format_offset(st.tail().bytes),
        None => format_offset(0),
    }
}

/// Reject webhook URLs that could reach internal networks (SSRF). http is
/// allowed for loopback only; private/link-local ranges always rejected.
fn webhook_url_allowed(url: &str) -> bool {
    let rest = if let Some(r) = url.strip_prefix("http://") {
        r
    } else if let Some(r) = url.strip_prefix("https://") {
        r
    } else {
        return false;
    };
    let host = rest.split(['/', ':']).next().unwrap_or("");
    let is_loopback = host == "localhost" || host.starts_with("127.") || host == "::1";
    let private = host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("169.254.")
        || (host.starts_with("172.")
            && host
                .split('.')
                .nth(1)
                .and_then(|s| s.parse::<u8>().ok())
                .map(|o| (16..=31).contains(&o))
                .unwrap_or(false));
    if private {
        return false;
    }
    if url.starts_with("http://") {
        return is_loopback;
    }
    true
}

// ---------------- activity hook ----------------

/// Called by handlers after data lands on a stream. Links matching pattern
/// subscriptions and triggers wakes.
pub fn on_activity(store: &Arc<Store>, full_path: &str) {
    let mgr = match store.subs.get() {
        Some(m) => m.clone(),
        None => return,
    };
    let mut to_wake: Vec<String> = Vec::new();
    {
        let mut subs = mgr.subs.lock().unwrap();
        if subs.is_empty() {
            return;
        }
        for sub in subs.values_mut() {
            let rel = match rel_path(&sub.root, full_path) {
                Some(r) => r.to_string(),
                None => continue,
            };
            let linked = sub.links.contains_key(&rel);
            let matches = linked
                || sub
                    .pattern
                    .as_deref()
                    .map(|p| glob_match(p, &rel))
                    .unwrap_or(false);
            if !matches {
                continue;
            }
            if !linked {
                // New stream matching the pattern: deliver from its beginning.
                sub.links.insert(
                    rel.clone(),
                    Link {
                        explicit: false,
                        acked: format_offset(0),
                    },
                );
            }
            if sub.wake.is_some() {
                sub.pending = true;
            } else {
                to_wake.push(sub.id.clone());
            }
        }
    }
    for id in to_wake {
        trigger_wake(store.clone(), mgr.clone(), id);
    }
}

/// Issue a wake for a subscription: webhook delivery or wake-stream event.
fn trigger_wake(store: Arc<Store>, mgr: Arc<SubsManager>, id: String) {
    tokio::spawn(async move {
        // Snapshot under lock.
        let (kind, body, sig, url, lease_ms, wake_id) = {
            let mut subs = mgr.subs.lock().unwrap();
            let sub = match subs.get_mut(&id) {
                Some(s) => s,
                None => return,
            };
            if sub.wake.is_some() {
                sub.pending = true;
                return;
            }
            sub.generation += 1;
            sub.pending = false;
            let wake_id = random_id("w_");
            let token = random_id("tok_");
            match &sub.kind {
                Kind::Webhook { url } => {
                    let streams = stream_list_json(&store, sub);
                    let body = json!({
                        "subscription_id": sub.id,
                        "wake_id": wake_id,
                        "generation": sub.generation,
                        "streams": streams,
                        "callback_url": format!("http://{}{}/__ds/subscriptions/{}/callback", sub.host, sub.root, sub.id),
                        "callback_token": token,
                    });
                    sub.wake = Some(Wake {
                        wake_id: wake_id.clone(),
                        token,
                        holder: None,
                        deadline: Instant::now() + Duration::from_millis(sub.lease_ttl_ms),
                    });
                    let raw = serde_json::to_vec(&body).unwrap();
                    let sig = mgr.sign(&raw);
                    (
                        0u8,
                        raw,
                        sig,
                        url.clone(),
                        sub.lease_ttl_ms,
                        wake_id,
                    )
                }
                Kind::PullWake { wake_stream } => {
                    // Wake events go through the normal stream append path; no
                    // lease starts until a worker claims.
                    sub.generation -= 1; // claim() assigns the generation
                    let ev = json!({
                        "type": "wake",
                        "subscription_id": sub.id,
                        "generation": sub.generation + 1,
                        "ts": unix_now() * 1000,
                    });
                    let full = format!("{}/{}", sub.root, wake_stream);
                    (1u8, serde_json::to_vec(&ev).unwrap(), String::new(), full, 0, wake_id)
                }
            }
        };

        if kind == 1 {
            // pull-wake: append the wake event.
            let _ = crate::handlers::internal_append_json(&store, &url, &body).await;
            return;
        }

        // Webhook delivery.
        let resp = http_post_json(&url, &sig, &body).await;
        let done = match &resp {
            Some((200, raw)) => serde_json::from_slice::<Value>(raw)
                .ok()
                .and_then(|v| v.get("done").and_then(|d| d.as_bool()))
                .unwrap_or(false),
            _ => false,
        };
        if done {
            // Synchronous done: auto-ack the snapshot tails and finish.
            let again = {
                let mut subs = mgr.subs.lock().unwrap();
                let sub = match subs.get_mut(&id) {
                    Some(s) => s,
                    None => return,
                };
                if sub.wake.as_ref().map(|w| w.wake_id.as_str()) != Some(wake_id.as_str()) {
                    return;
                }
                let paths: Vec<String> = sub.links.keys().cloned().collect();
                for p in paths {
                    let tail = stream_tail(&store, &sub.root, &p);
                    if let Some(link) = sub.links.get_mut(&p) {
                        if link.acked < tail {
                            link.acked = tail;
                        }
                    }
                }
                sub.wake = None;
                let again = sub.pending || has_pending(&store, sub);
                sub.pending = false;
                again
            };
            if again {
                trigger_wake(store, mgr, id);
            }
            return;
        }

        // Await callback until the lease expires; then re-wake if pending.
        tokio::time::sleep(Duration::from_millis(lease_ms.max(50))).await;
        let again = {
            let mut subs = mgr.subs.lock().unwrap();
            let sub = match subs.get_mut(&id) {
                Some(s) => s,
                None => return,
            };
            if sub.wake.as_ref().map(|w| w.wake_id.as_str()) != Some(wake_id.as_str()) {
                return; // callback already settled this wake
            }
            sub.wake = None;
            let again = sub.pending || has_pending(&store, sub);
            sub.pending = false;
            again
        };
        if again {
            trigger_wake(store, mgr, id);
        }
    });
}

fn has_pending(store: &Store, sub: &Sub) -> bool {
    sub.links
        .iter()
        .any(|(path, link)| link.acked < stream_tail(store, &sub.root, path))
}

/// Per-stream JSON objects for wake/claim payloads (includes live tail + pending).
fn stream_list_json(store: &Store, sub: &Sub) -> Vec<Value> {
    sub.links
        .iter()
        .map(|(path, link)| {
            let tail = stream_tail(store, &sub.root, path);
            json!({
                "path": path,
                "link_type": if link.explicit { "explicit" } else { "glob" },
                "acked_offset": link.acked,
                "tail_offset": tail,
                "has_pending": link.acked < tail,
            })
        })
        .collect()
}

// ---------------- request routing ----------------

/// Handle a request whose path contains the reserved `__ds` prefix.
/// `root` is the path before `/__ds`; `rest` is what follows it.
pub async fn handle_ds(store: Arc<Store>, req: Req, root: String, rest: String) -> Resp {
    let mgr = match store.subs.get() {
        Some(m) => m.clone(),
        None => return error_response(501, "SUBSCRIPTIONS_DISABLED", None),
    };
    let parts: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
    match (req.method, parts.as_slice()) {
        (Method::Get, ["jwks.json"]) => {
            let mut r = json_response(200, &mgr.jwks());
            r.headers[0].1 = "application/jwk-set+json".to_string();
            r.headers
                .push(("cache-control", "public, max-age=300".to_string()));
            r
        }
        (Method::Put, ["subscriptions", id]) => put_subscription(&store, &mgr, &req, &root, id),
        (Method::Get, ["subscriptions", id]) => {
            let subs = mgr.subs.lock().unwrap();
            match subs.get(*id) {
                Some(sub) => {
                    let mut v = sub_json(sub);
                    if let Kind::Webhook { .. } = sub.kind {
                        v["webhook"]["signing"]["kid"] = json!(mgr.kid);
                    }
                    json_response(200, &v)
                }
                None => error_response(404, "SUBSCRIPTION_NOT_FOUND", None),
            }
        }
        (Method::Delete, ["subscriptions", id]) => {
            let removed = mgr.subs.lock().unwrap().remove(*id).is_some();
            if removed {
                Resp::new(204)
            } else {
                error_response(404, "SUBSCRIPTION_NOT_FOUND", None)
            }
        }
        (Method::Post, ["subscriptions", id, "streams"]) => {
            let parsed: Option<Value> = serde_json::from_slice(&req.body).ok();
            let streams = parsed
                .as_ref()
                .and_then(|v| v.get("streams"))
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|s| s.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>()
                });
            let mut subs = mgr.subs.lock().unwrap();
            match (subs.get_mut(*id), streams) {
                (Some(sub), Some(streams)) => {
                    for rel in streams {
                        let tail = stream_tail(&store, &sub.root, &rel);
                        sub.links
                            .entry(rel)
                            .or_insert(Link {
                                explicit: true,
                                acked: tail,
                            })
                            .explicit = true;
                    }
                    Resp::new(204)
                }
                (None, _) => error_response(404, "SUBSCRIPTION_NOT_FOUND", None),
                _ => error_response(400, "INVALID_REQUEST", None),
            }
        }
        (Method::Delete, ["subscriptions", id, "streams", enc]) => {
            let rel = percent_encoding::percent_decode_str(enc)
                .decode_utf8_lossy()
                .to_string();
            let mut subs = mgr.subs.lock().unwrap();
            match subs.get_mut(*id) {
                Some(sub) => {
                    // Removes the explicit link; a matching glob link remains.
                    if let Some(link) = sub.links.get(&rel) {
                        let glob_covers = sub
                            .pattern
                            .as_deref()
                            .map(|p| glob_match(p, &rel))
                            .unwrap_or(false);
                        if link.explicit && glob_covers {
                            sub.links.get_mut(&rel).unwrap().explicit = false;
                        } else {
                            sub.links.remove(&rel);
                        }
                    }
                    Resp::new(204)
                }
                None => error_response(404, "SUBSCRIPTION_NOT_FOUND", None),
            }
        }
        (Method::Post, ["subscriptions", id, "callback"])
        | (Method::Post, ["subscriptions", id, "ack"]) => ack_wake(&store, &mgr, &req, id),
        (Method::Post, ["subscriptions", id, "claim"]) => claim_wake(&store, &mgr, &req, id),
        (Method::Post, ["subscriptions", id, "release"]) => release_wake(&store, &mgr, &req, id),
        _ => error_response(404, "NOT_FOUND", None),
    }
}

fn put_subscription(store: &Arc<Store>, mgr: &Arc<SubsManager>, req: &Req, root: &str, id: &str) -> Resp {
    let v: Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return error_response(400, "INVALID_JSON", None),
    };
    let kind = match v.get("type").and_then(|t| t.as_str()) {
        Some("webhook") => {
            let url = match v.pointer("/webhook/url").and_then(|u| u.as_str()) {
                Some(u) => u.to_string(),
                None => return error_response(400, "MISSING_WEBHOOK_URL", None),
            };
            if !webhook_url_allowed(&url) {
                return error_response(400, "WEBHOOK_URL_REJECTED", None);
            }
            Kind::Webhook { url }
        }
        Some("pull-wake") => match v.get("wake_stream").and_then(|w| w.as_str()) {
            Some(w) => Kind::PullWake {
                wake_stream: w.to_string(),
            },
            None => return error_response(400, "MISSING_WAKE_STREAM", None),
        },
        _ => return error_response(400, "INVALID_TYPE", None),
    };
    let pattern = v.get("pattern").and_then(|p| p.as_str()).map(String::from);
    let explicit: Vec<String> = v
        .get("streams")
        .and_then(|s| s.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if pattern.is_none() && explicit.is_empty() {
        return error_response(400, "MISSING_STREAM_SELECTION", None);
    }
    let lease_ttl_ms = v
        .get("lease_ttl_ms")
        .and_then(|l| l.as_u64())
        .unwrap_or(30_000)
        .clamp(1_000, 600_000);
    let description = v
        .get("description")
        .and_then(|d| d.as_str())
        .map(String::from);
    let host = req.header("host").unwrap_or("localhost").to_string();

    let mut subs = mgr.subs.lock().unwrap();
    if let Some(existing) = subs.get(id) {
        let same = existing.kind == kind
            && existing.pattern == pattern
            && existing.explicit_streams == explicit
            && existing.lease_ttl_ms == lease_ttl_ms
            && existing.description == description;
        return if same {
            let mut v = sub_json(existing);
            if let Kind::Webhook { .. } = existing.kind {
                v["webhook"]["signing"]["kid"] = json!(mgr.kid);
            }
            json_response(200, &v)
        } else {
            error_response(409, "SUBSCRIPTION_CONFLICT", None)
        };
    }

    let mut sub = Sub {
        id: id.to_string(),
        root: root.to_string(),
        host,
        kind,
        pattern: pattern.clone(),
        explicit_streams: explicit.clone(),
        lease_ttl_ms,
        description,
        links: BTreeMap::new(),
        generation: 0,
        wake: None,
        pending: false,
        created_at: rfc3339(unix_now()),
    };
    // Backfill: pattern-matching existing streams link at their current tail
    // (no historical replay); explicit streams likewise.
    if let Some(p) = &pattern {
        for entry in store.streams.iter() {
            if let Some(rel) = rel_path(root, entry.key()) {
                if glob_match(p, rel) {
                    let tail = format_offset(entry.value().tail().bytes);
                    sub.links.insert(
                        rel.to_string(),
                        Link {
                            explicit: false,
                            acked: tail,
                        },
                    );
                }
            }
        }
    }
    for rel in &explicit {
        let tail = stream_tail(store, root, rel);
        sub.links.insert(
            rel.clone(),
            Link {
                explicit: true,
                acked: tail,
            },
        );
    }
    let mut resp = sub_json(&sub);
    if let Kind::Webhook { .. } = sub.kind {
        resp["webhook"]["signing"]["kid"] = json!(mgr.kid);
    }
    subs.insert(id.to_string(), sub);
    json_response(201, &resp)
}

/// Shared by webhook `callback` and pull-wake `ack`.
fn ack_wake(store: &Arc<Store>, mgr: &Arc<SubsManager>, req: &Req, id: &str) -> Resp {
    let v: Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return error_response(400, "INVALID_JSON", None),
    };
    let token = bearer_token(req);
    let mut subs = mgr.subs.lock().unwrap();
    let sub = match subs.get_mut(id) {
        Some(s) => s,
        None => return error_response(404, "SUBSCRIPTION_NOT_FOUND", None),
    };
    let valid = sub.wake.as_ref().is_some_and(|w| {
        Some(w.token.as_str()) == token
            && v.get("wake_id").and_then(|x| x.as_str()) == Some(w.wake_id.as_str())
            && v.get("generation").and_then(|x| x.as_u64()) == Some(sub.generation)
    });
    if !valid {
        return error_response(409, "FENCED", None);
    }
    if let Some(acks) = v.get("acks").and_then(|a| a.as_array()) {
        for ack in acks {
            if let (Some(stream), Some(offset)) = (
                ack.get("stream").and_then(|s| s.as_str()),
                ack.get("offset").and_then(|o| o.as_str()),
            ) {
                if let Some(link) = sub.links.get_mut(stream) {
                    if link.acked.as_str() < offset {
                        link.acked = offset.to_string();
                    }
                }
            }
        }
    }
    let done = v.get("done").and_then(|d| d.as_bool()).unwrap_or(false);
    if done {
        sub.wake = None;
        let next_wake = sub.pending || has_pending(store, sub);
        sub.pending = false;
        let sub_id = sub.id.clone();
        drop(subs);
        if next_wake {
            trigger_wake(store.clone(), mgr.clone(), sub_id);
        }
        json_response(200, &json!({ "ok": true, "next_wake": next_wake }))
    } else {
        // Heartbeat: extend the lease.
        let ttl = sub.lease_ttl_ms;
        if let Some(w) = sub.wake.as_mut() {
            w.deadline = Instant::now() + Duration::from_millis(ttl);
        }
        json_response(200, &json!({ "ok": true, "next_wake": false }))
    }
}

fn claim_wake(store: &Arc<Store>, mgr: &Arc<SubsManager>, req: &Req, id: &str) -> Resp {
    let v: Value = serde_json::from_slice(&req.body).unwrap_or(json!({}));
    let worker = v
        .get("worker")
        .and_then(|w| w.as_str())
        .unwrap_or("worker")
        .to_string();
    let mut subs = mgr.subs.lock().unwrap();
    let sub = match subs.get_mut(id) {
        Some(s) => s,
        None => return error_response(404, "SUBSCRIPTION_NOT_FOUND", None),
    };
    if let Some(w) = &sub.wake {
        if w.deadline > Instant::now() {
            return error_response(
                409,
                "ALREADY_CLAIMED",
                Some(json!({ "current_holder": w.holder.clone().unwrap_or_default(), "generation": sub.generation })),
            );
        }
    }
    sub.generation += 1;
    let wake_id = random_id("w_");
    let token = random_id("tok_");
    sub.wake = Some(Wake {
        wake_id: wake_id.clone(),
        token: token.clone(),
        holder: Some(worker),
        deadline: Instant::now() + Duration::from_millis(sub.lease_ttl_ms),
    });
    sub.pending = false;
    let streams = stream_list_json(store, sub);
    json_response(
        200,
        &json!({
            "wake_id": wake_id,
            "generation": sub.generation,
            "token": token,
            "streams": streams,
            "lease_ttl_ms": sub.lease_ttl_ms,
        }),
    )
}

fn release_wake(store: &Arc<Store>, mgr: &Arc<SubsManager>, req: &Req, id: &str) -> Resp {
    let v: Value = serde_json::from_slice(&req.body).unwrap_or(json!({}));
    let token = bearer_token(req);
    let mut subs = mgr.subs.lock().unwrap();
    let sub = match subs.get_mut(id) {
        Some(s) => s,
        None => return error_response(404, "SUBSCRIPTION_NOT_FOUND", None),
    };
    let valid = sub.wake.as_ref().is_some_and(|w| {
        Some(w.token.as_str()) == token
            && v.get("wake_id").and_then(|x| x.as_str()) == Some(w.wake_id.as_str())
            && v.get("generation").and_then(|x| x.as_u64()) == Some(sub.generation)
    });
    if !valid {
        return error_response(409, "FENCED", None);
    }
    sub.wake = None;
    let pending = sub.pending || has_pending(store, sub);
    sub.pending = false;
    let sub_id = sub.id.clone();
    drop(subs);
    if pending {
        trigger_wake(store.clone(), mgr.clone(), sub_id);
    }
    Resp::new(204)
}

fn bearer_token(req: &Req) -> Option<&str> {
    req.header("authorization")?.strip_prefix("Bearer ")
}
