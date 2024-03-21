// No-op serialisation for bytes - SQLite should be able to ingest
// them as they are
export function serialiseBytes(v: Uint8Array): Uint8Array {
  return v
}

// No-op deserialisation for bytes - SQLite should be returning them
// as they are
export function deserialiseBytes(v: Uint8Array): Uint8Array {
  return v
}
