// No-op serialisation for blobs - SQLite should be able to ingest
// them as they are
export function serialiseBlob(v: Uint8Array): Uint8Array {
  return v
}

// No-op deserialisation for bytes - SQLite should be returning them
// as they are
export function deserialiseBlob(v: Uint8Array): Uint8Array {
  return v
}
