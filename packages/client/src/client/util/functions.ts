export function notNullNotUndefined<T>(v: T): v is NonNullable<T> {
  return typeof v !== 'undefined' && v !== null
}

/**
 * Maps a given function over the entries of an object.
 * @param obj The object to map over.
 * @param f The function to map over the object's entries.
 * @returns Object containing the mapped values.
 */
export function mapObject<V, W, T extends Record<string, V>>(
  obj: T,
  f: (key: string, value: V) => W
): Record<string, W> {
  return Object.fromEntries(
    Object.entries(obj).map((entry) => {
      const [key, value] = entry
      return [key, f(key, value)]
    })
  )
}
