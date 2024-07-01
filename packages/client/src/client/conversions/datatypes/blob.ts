// No-op serialisation for blobs - SQLite should be able to ingest
// them as they are
export function serialiseBlob(v: Uint8Array): Uint8Array {
  return v
}

// Casting byte array to Uint8Array for consistency as some drivers might
// return a Node Buffer or other Uint8Array extension - not strictly
// necessary but improved DX for testing, debugging, and asserting
export function deserialiseBlob(v: Uint8Array): Uint8Array {
  return new Uint8Array(v)
}
