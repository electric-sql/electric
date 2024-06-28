/**
 * Calculate a set difference between two arrays
 *
 * @returns an array with elements from the first array that are not present in the second array
 */
export function difference<T>(a: T[], b: T[]): T[] {
  const bset = new Set(b)
  return a.filter((x) => !bset.has(x))
}

/**
 * Calculate a set union of two arrays.
 *
 * If there are non-unique elements in either array, they will be lost.
 *
 * @returns an array with all unique elements from two source arrays
 */
export function union<T>(a: T[], b: T[]): T[] {
  return Array.from(new Set([...a, ...b]))
}
