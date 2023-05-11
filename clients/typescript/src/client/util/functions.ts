export function notNullNotUndefined<T>(v: T): v is NonNullable<T> {
  return typeof v !== 'undefined' && v !== null
}
