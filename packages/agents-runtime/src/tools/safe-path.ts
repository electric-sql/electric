import { realpath } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

/**
 * Resolve a user-supplied path against the working directory and verify it
 * stays inside, following symlinks. Defends against the
 * CVE-2025-53109/53110-shape bypass where `relative()` reports a clean path
 * but the underlying file is a symlink to outside the workspace.
 *
 * - For paths that already exist, returns the canonicalized realpath.
 * - For paths that don't yet exist (write/mkdir into a new file), walks up
 *   to the deepest existing ancestor and verifies its realpath is inside
 *   the workspace; returns the canonicalized ancestor joined with the
 *   non-existing remainder so callers can use it as the FS target without
 *   the OS following an attacker-controlled symlink mid-path.
 *
 * Returns `null` if the resolved path escapes the working directory.
 */
export async function resolveSafePath(
  workingDirectory: string,
  userPath: string
): Promise<string | null> {
  const cwdReal = await realpath(workingDirectory)
  const resolved = resolve(workingDirectory, userPath)
  const initialRel = relative(cwdReal, resolve(cwdReal, userPath))
  if (initialRel.startsWith(`..`)) return null

  let probe = resolved
  let suffix = ``
  for (;;) {
    try {
      const real = await realpath(probe)
      const rel = relative(cwdReal, real)
      if (rel.startsWith(`..`) || rel === `..`) return null
      return suffix.length === 0 ? real : resolve(real, suffix)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== `ENOENT`) throw err
      const parent = dirname(probe)
      if (parent === probe) return null
      suffix =
        suffix.length === 0
          ? probe.slice(parent.length + 1)
          : `${probe.slice(parent.length + 1)}/${suffix}`
      probe = parent
    }
  }
}
