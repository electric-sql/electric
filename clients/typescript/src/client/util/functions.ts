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

/**
 * Checks that the two objects have the same keys
 * and the value associated to each key is of the same type.
 */
export function equallyTypedObjects(
  o1: Record<string, any>,
  o2: Record<string, any>
): boolean {
  const keys1 = Object.keys(o1)
  const keys2 = Object.keys(o2)

  if (keys1.length !== keys2.length) {
    return false
  }

  for (const key of keys1) {
    if (!Object.hasOwn(o2, key) || typeof o1[key] !== typeof o2[key]) {
      return false
    }
  }

  return true
}
