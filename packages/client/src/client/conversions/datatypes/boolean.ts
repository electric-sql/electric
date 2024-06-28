// Serialises a boolean to a number (0 for false and 1 for true)
export function serialiseBoolean(v: boolean): number {
  return v ? 1 : 0
}

// Deserialises a SQLite boolean (i.e. 0 or 1) into a boolean value
export function deserialiseBoolean(v: number): boolean {
  if (v === 0) return false
  else if (v === 1) return true
  else throw new Error(`Could not parse boolean. Value is not 0 or 1: ${v}`)
}
