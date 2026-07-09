// BlobStore: the cold-tier object-storage abstraction.
//
// The hot tier stays fd-backed (the contiguous data file + sealed chunk files,
// served zero-copy via sendfile/io_uring). The BlobStore is the *remote* tier: a
// sealed segment is uploaded here, verified, and only then is its local chunk
// file unlinked. Reads of an offloaded segment go through `get_range`.
//
// Two adapters:
//   - `LocalFsBlobStore` — a chunk directory on local disk. No heavy deps; the
//     primary use is testing the full seal→offload→read-from-cold path without
//     standing up S3. Always compiled.
//   - `S3BlobStore` — a generic S3-compatible adapter over the `object_store`
//     crate, behind the `tier` Cargo feature. Works against AWS S3, Cloudflare
//     R2, Fly/Tigris, MinIO, Backblaze B2, etc. via custom endpoint + path-style
//     addressing. Only compiled with `--features tier`.
//
// The trait uses explicitly-boxed futures rather than the `async_trait` macro so
// the default build pulls in no extra proc-macro dependency.

use std::io;
use std::sync::Arc;

use bytes::Bytes;

pub type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

/// Object-storage backend for the cold tier. Object keys are opaque strings; the
/// manifest owns key layout. All methods run off the append hot path.
pub trait BlobStore: Send + Sync {
    /// Upload an object in full.
    fn put<'a>(&'a self, key: &'a str, body: Bytes) -> BoxFuture<'a, io::Result<()>>;
    /// Read `[start, start+len)` of an object.
    fn get_range<'a>(
        &'a self,
        key: &'a str,
        start: u64,
        len: u64,
    ) -> BoxFuture<'a, io::Result<Bytes>>;
    /// Object size, or None if it does not exist (used to verify before delete).
    fn head<'a>(&'a self, key: &'a str) -> BoxFuture<'a, io::Result<Option<u64>>>;
    /// Delete an object. Missing-object is not an error (idempotent).
    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, io::Result<()>>;
}

/// Shared handle to a BlobStore.
pub type SharedBlobStore = Arc<dyn BlobStore>;

/// Validate a `[start, start+len)` byte-range request and return it as a usize
/// `start..end`. Rejects `u64` overflow and ranges that exceed this platform's
/// `usize` — defence against a corrupt/hostile manifest minting a wrapped or
/// truncated range (which could otherwise read the wrong bytes or over-allocate).
fn checked_range(start: u64, len: u64) -> io::Result<std::ops::Range<usize>> {
    let end = start
        .checked_add(len)
        .ok_or_else(|| io::Error::other("blob range overflow"))?;
    let s = usize::try_from(start).map_err(|_| io::Error::other("blob range start too large"))?;
    let e = usize::try_from(end).map_err(|_| io::Error::other("blob range end too large"))?;
    Ok(s..e)
}

// ---------------- local filesystem adapter ----------------

/// A BlobStore backed by a local directory. Each object is a file whose name is
/// the key with `/` replaced by `_` (keys are flat segment keys, so this is
/// unambiguous). Used for tests and `--tier local`.
pub struct LocalFsBlobStore {
    dir: std::path::PathBuf,
}

impl LocalFsBlobStore {
    pub fn new(dir: std::path::PathBuf) -> io::Result<Self> {
        std::fs::create_dir_all(&dir)?;
        Ok(LocalFsBlobStore { dir })
    }

    fn path_for(&self, key: &str) -> std::path::PathBuf {
        self.dir.join(key.replace('/', "_"))
    }
}

impl BlobStore for LocalFsBlobStore {
    fn put<'a>(&'a self, key: &'a str, body: Bytes) -> BoxFuture<'a, io::Result<()>> {
        let path = self.path_for(key);
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                use std::io::Write;
                let tmp = path.with_extension("tmp");
                {
                    let mut f = std::fs::File::create(&tmp)?;
                    f.write_all(&body)?;
                    f.sync_all()?;
                }
                std::fs::rename(&tmp, &path)
            })
            .await
            .map_err(io::Error::other)?
        })
    }

    fn get_range<'a>(
        &'a self,
        key: &'a str,
        start: u64,
        len: u64,
    ) -> BoxFuture<'a, io::Result<Bytes>> {
        let path = self.path_for(key);
        Box::pin(async move {
            let range = checked_range(start, len)?;
            tokio::task::spawn_blocking(move || {
                use std::os::unix::fs::FileExt;
                let f = std::fs::File::open(&path)?;
                let mut buf = vec![0u8; range.len()];
                f.read_exact_at(&mut buf, start)?;
                Ok(Bytes::from(buf))
            })
            .await
            .map_err(io::Error::other)?
        })
    }

    fn head<'a>(&'a self, key: &'a str) -> BoxFuture<'a, io::Result<Option<u64>>> {
        let path = self.path_for(key);
        Box::pin(async move {
            tokio::task::spawn_blocking(move || match std::fs::metadata(&path) {
                Ok(m) => Ok(Some(m.len())),
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(e),
            })
            .await
            .map_err(io::Error::other)?
        })
    }

    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, io::Result<()>> {
        let path = self.path_for(key);
        Box::pin(async move {
            tokio::task::spawn_blocking(move || match std::fs::remove_file(&path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e),
            })
            .await
            .map_err(io::Error::other)?
        })
    }
}

// ---------------- S3-compatible adapter (feature `tier`) ----------------

#[cfg(feature = "tier")]
pub use s3::S3BlobStore;

#[cfg(feature = "tier")]
mod s3 {
    use super::*;
    use object_store::aws::AmazonS3Builder;
    use object_store::{GetOptions, GetRange, ObjectStore};
    use object_store::path::Path as ObjPath;

    /// A generic S3-compatible BlobStore over `object_store`. Configured with a
    /// custom endpoint + path-style addressing so it targets any S3-compatible
    /// provider (AWS, Cloudflare R2, Fly/Tigris, MinIO, Backblaze B2), not just
    /// AWS.
    pub struct S3BlobStore {
        inner: object_store::aws::AmazonS3,
    }

    impl S3BlobStore {
        pub fn new(cfg: &crate::tier::TierConfig) -> io::Result<Self> {
            let bucket = cfg
                .bucket
                .as_ref()
                .ok_or_else(|| io::Error::other("--tier-bucket is required for --tier s3"))?;
            let mut b = AmazonS3Builder::new().with_bucket_name(bucket);
            if let Some(ep) = &cfg.endpoint {
                b = b.with_endpoint(ep.clone());
            }
            if let Some(region) = &cfg.region {
                b = b.with_region(region.clone());
            }
            // Path-style addressing (vs virtual-hosted) — required by MinIO and
            // most S3-compatible providers when using a custom endpoint.
            b = b.with_virtual_hosted_style_request(!cfg.path_style);
            if cfg.allow_http {
                b = b.with_allow_http(true);
            }
            if let (Some(k), Some(s)) = (&cfg.access_key_id, &cfg.secret_access_key) {
                b = b.with_access_key_id(k.clone()).with_secret_access_key(s.clone());
            }
            let inner = b.build().map_err(io::Error::other)?;
            Ok(S3BlobStore { inner })
        }
    }

    impl BlobStore for S3BlobStore {
        fn put<'a>(&'a self, key: &'a str, body: Bytes) -> BoxFuture<'a, io::Result<()>> {
            let path = ObjPath::from(key);
            Box::pin(async move {
                self.inner
                    .put(&path, body.into())
                    .await
                    .map(|_| ())
                    .map_err(io::Error::other)
            })
        }

        fn get_range<'a>(
            &'a self,
            key: &'a str,
            start: u64,
            len: u64,
        ) -> BoxFuture<'a, io::Result<Bytes>> {
            let path = ObjPath::from(key);
            Box::pin(async move {
                let range = super::checked_range(start, len)?;
                let opts = GetOptions {
                    range: Some(GetRange::Bounded(range)),
                    ..Default::default()
                };
                let res = self
                    .inner
                    .get_opts(&path, opts)
                    .await
                    .map_err(io::Error::other)?;
                res.bytes().await.map_err(io::Error::other)
            })
        }

        fn head<'a>(&'a self, key: &'a str) -> BoxFuture<'a, io::Result<Option<u64>>> {
            let path = ObjPath::from(key);
            Box::pin(async move {
                match self.inner.head(&path).await {
                    Ok(meta) => Ok(Some(meta.size as u64)),
                    Err(object_store::Error::NotFound { .. }) => Ok(None),
                    Err(e) => Err(io::Error::other(e)),
                }
            })
        }

        fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, io::Result<()>> {
            let path = ObjPath::from(key);
            Box::pin(async move {
                match self.inner.delete(&path).await {
                    Ok(()) => Ok(()),
                    Err(object_store::Error::NotFound { .. }) => Ok(()),
                    Err(e) => Err(io::Error::other(e)),
                }
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_blobstore_roundtrip() {
        let dir = std::env::temp_dir().join(format!("ds-blob-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let bs = LocalFsBlobStore::new(dir.clone()).unwrap();
        let key = "stream-abc/0000000000000000";
        bs.put(key, Bytes::from_static(b"hello world payload"))
            .await
            .unwrap();
        assert_eq!(bs.head(key).await.unwrap(), Some(19));
        let got = bs.get_range(key, 6, 5).await.unwrap();
        assert_eq!(&got[..], b"world");
        bs.delete(key).await.unwrap();
        assert_eq!(bs.head(key).await.unwrap(), None);
        // Idempotent delete.
        bs.delete(key).await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    // S3-compatible adapter integration test against a real MinIO server.
    // Ignored by default — run manually after starting MinIO:
    //
    //   docker run -d --rm -p 9000:9000 -e MINIO_ROOT_USER=minioadmin \
    //     -e MINIO_ROOT_PASSWORD=minioadmin minio/minio server /data
    //   # create the bucket (mc or the console at :9000), e.g. "ds-tier-test"
    //
    //   DS_S3_ACCESS_KEY_ID=minioadmin DS_S3_SECRET_ACCESS_KEY=minioadmin \
    //   cargo test --features tier s3_minio_roundtrip -- --ignored --nocapture
    #[cfg(feature = "tier")]
    #[tokio::test]
    #[ignore]
    async fn s3_minio_roundtrip() {
        let cfg = crate::tier::TierConfig {
            kind: crate::tier::TierKind::S3,
            endpoint: Some("http://127.0.0.1:9000".into()),
            region: Some("us-east-1".into()),
            bucket: Some(
                std::env::var("DS_S3_BUCKET").unwrap_or_else(|_| "ds-tier-test".into()),
            ),
            path_style: true,
            allow_http: true,
            access_key_id: std::env::var("DS_S3_ACCESS_KEY_ID").ok(),
            secret_access_key: std::env::var("DS_S3_SECRET_ACCESS_KEY").ok(),
            ..Default::default()
        };
        let bs = S3BlobStore::new(&cfg).expect("build S3 blobstore");
        let key = "stream-test/0000000000000042";
        let payload = Bytes::from_static(b"the quick brown fox jumps over the lazy dog");
        bs.put(key, payload.clone()).await.expect("put");
        assert_eq!(bs.head(key).await.expect("head"), Some(payload.len() as u64));
        let got = bs.get_range(key, 4, 5).await.expect("get_range");
        assert_eq!(&got[..], b"quick");
        bs.delete(key).await.expect("delete");
        assert_eq!(bs.head(key).await.expect("head after delete"), None);
    }
}
