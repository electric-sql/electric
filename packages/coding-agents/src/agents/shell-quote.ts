/**
 * Single-quote a string for safe interpolation into a /bin/sh command.
 * Wraps in '...' and escapes embedded single quotes via the standard
 * '\'' close-and-reopen pattern. Each adapter that builds shell
 * commands (claude, codex, opencode) uses this; the shared helper keeps
 * the implementation in one place.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
