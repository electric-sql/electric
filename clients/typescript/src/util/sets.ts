export function difference<T>(a: T[], b: T[]): T[] {
  const bset = new Set(b)
  return a.filter((x) => !bset.has(x))
}

export function union<T>(a: T[], b: T[]): T[] {
  return Array.from(new Set([...a, ...b]))
}
