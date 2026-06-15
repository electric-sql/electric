/**
 * Minimal stub for expo-linking used in the vitest environment.
 * The real expo-linking transitively imports react-native (which uses Flow
 * `import typeof` syntax that Rollup/Vite cannot parse). This stub replaces
 * it for unit tests with a pure-TS implementation that uses the URL API.
 */
export function parse(url: string): {
  scheme: string | null
  hostname: string | null
  path: string | null
  queryParams: Record<string, string>
} {
  const queryParams: Record<string, string> = {}
  let hostname: string | null = null
  let scheme: string | null = null
  let path: string | null = null
  try {
    const parsed = new URL(url)
    parsed.searchParams.forEach((value, key) => {
      // URLSearchParams already percent-decodes values; decoding again would
      // double-decode (and throw on a literal `%`), diverging from real
      // expo-linking.
      queryParams[key] = value
    })
    path = parsed.pathname || null
    hostname = parsed.hostname || null
    scheme = parsed.protocol ? parsed.protocol.slice(0, -1) : null
  } catch {
    // non-standard scheme URLs may fail; return empty
  }
  return { scheme, hostname, path, queryParams }
}
