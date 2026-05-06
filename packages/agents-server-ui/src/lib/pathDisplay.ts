/**
 * Display helpers for filesystem paths in the renderer.
 *
 * The renderer doesn't have access to `os.homedir()` or `path.sep`,
 * so all of these helpers work off heuristics: they recognise the
 * standard `/Users/<name>` (macOS), `/home/<name>` (Linux), and
 * `C:\Users\<name>` (Windows) prefixes for home dirs, and accept
 * either `/` or `\` as a path separator. They degrade gracefully
 * when their inputs don't fit those shapes — paths render as-is
 * rather than throwing.
 */

const HOME_PREFIX_PATTERNS: ReadonlyArray<RegExp> = [
  /^(\/Users\/[^/]+)/,
  /^(\/home\/[^/]+)/,
  /^([A-Za-z]:\\Users\\[^\\]+)/,
]

/**
 * Sniff a likely home directory from a list of absolute paths.
 * Returns the first prefix that matches one of the known shapes
 * (`/Users/<name>`, `/home/<name>`, `C:\Users\<name>`) or `null`
 * when no candidate matches. Used by the picker (recents) and by
 * the sidebar grouping label so both UIs render the same `~`-style
 * abbreviations without needing IPC to ask the main process.
 */
export function detectHomeDir(
  paths: ReadonlyArray<string | null | undefined>
): string | null {
  for (const p of paths) {
    if (typeof p !== `string` || p.length === 0) continue
    for (const pattern of HOME_PREFIX_PATTERNS) {
      const m = p.match(pattern)
      if (m) return m[1] ?? null
    }
  }
  return null
}

/**
 * Replace the home directory prefix with `~` in a display path.
 * Idempotent on paths that don't start with `homeDir`. Honours
 * either `/` or `\` after the home dir so the same helper works
 * on macOS, Linux, and Windows-style paths.
 */
export function tildifyPath(path: string, homeDir: string | null): string {
  if (!homeDir) return path
  if (path === homeDir) return `~`
  if (path.startsWith(homeDir + `/`)) return `~${path.slice(homeDir.length)}`
  if (path.startsWith(homeDir + `\\`)) return `~${path.slice(homeDir.length)}`
  return path
}

/**
 * Abbreviate a (preferably already-tildified) path so it fits in a
 * confined column. If the path fits within `maxLength` it's
 * returned as-is; otherwise we drop leading segments and prefix
 * `…/` so the deepest segments — usually the project folder —
 * stay visible. CSS ellipsis on its own would truncate the *end*
 * of the string, which is the most informative part for a
 * working-directory label, so we pre-abbreviate from the start
 * here instead.
 *
 *   `~/Code/electric` (15)              → `~/Code/electric`
 *   `~/Documents/work/projects/acme` (30) → `…/projects/acme`
 *   `~/very/deep/nested/repo/src/app` (32) → `…/src/app`
 *
 * If even the trailing segment exceeds the budget, it's truncated
 * with `…` at the start.
 */
export function abbreviatePath(
  path: string,
  opts?: { maxLength?: number }
): string {
  const maxLength = opts?.maxLength ?? 28
  if (path.length <= maxLength) return path

  // Use whichever separator dominates so we don't accidentally
  // re-join Windows segments with `/` or vice versa.
  const sep = path.includes(`\\`) && !path.includes(`/`) ? `\\` : `/`
  const segments = path.split(/[\\/]+/).filter((s) => s.length > 0)
  if (segments.length <= 1) {
    // Nothing to drop — single-segment path. Just chop the head.
    return `…${path.slice(path.length - (maxLength - 1))}`
  }

  const ellipsis = `…${sep}`
  let budget = maxLength - ellipsis.length
  const tail: Array<string> = []
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!
    // +1 for the joining separator between segments. The very
    // last segment doesn't need one but keeping the math simple
    // (always +1) just trims one char's worth of budget — fine.
    const cost = seg.length + 1
    if (cost > budget) break
    tail.unshift(seg)
    budget -= cost
  }

  if (tail.length === 0) {
    // Even the deepest segment is too long for the budget. Show
    // an ellipsis-prefixed truncation of just that segment so the
    // user still sees its tail (project name).
    const last = segments[segments.length - 1]!
    return `…${last.slice(last.length - (maxLength - 1))}`
  }
  return `${ellipsis}${tail.join(sep)}`
}

/**
 * One-shot helper used by sidebar grouping: detect the home dir
 * from the input list, tildify the target path against it, and
 * abbreviate to fit. Equivalent to chaining the three primitives
 * above but folds the common case into a single call.
 */
export function displayWorkingDirectory(
  path: string,
  contextPaths: ReadonlyArray<string | null | undefined> = [],
  opts?: { maxLength?: number }
): string {
  const homeDir = detectHomeDir([path, ...contextPaths])
  return abbreviatePath(tildifyPath(path, homeDir), opts)
}
