/**
 * Human-readable host for a server URL, used as a fallback display name when
 * the user hasn't given a server an explicit name. Falls back to the raw
 * string for inputs `new URL` can't parse (e.g. a bare hostname).
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}
