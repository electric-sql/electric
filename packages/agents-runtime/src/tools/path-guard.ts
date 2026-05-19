import { realpath } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

export type PathGuardResult =
  | { ok: true; resolved: string }
  | { ok: false; reason: string }

// Resolves `filePath` relative to `workingDirectory` and verifies it stays
// inside, both before and after symlink expansion. For non-existent
// targets (write/edit may create files) `realpath` is applied to the
// deepest existing ancestor. Hardlinks across the cwd boundary remain a
// known gap.
export async function resolveInsideWorkdir(
  filePath: string,
  workingDirectory: string
): Promise<PathGuardResult> {
  const resolved = resolve(workingDirectory, filePath)
  if (relative(workingDirectory, resolved).startsWith(`..`)) {
    return {
      ok: false,
      reason: `Path "${filePath}" is outside the working directory`,
    }
  }
  const realCwd = await realpath(workingDirectory)
  let probe = resolved
  while (true) {
    try {
      const realTarget = await realpath(probe)
      if (relative(realCwd, realTarget).startsWith(`..`)) {
        return {
          ok: false,
          reason: `Path "${filePath}" resolves outside the working directory via a symlink`,
        }
      }
      return { ok: true, resolved }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== `ENOENT` && code !== `ENOTDIR`) throw err
      const parent = dirname(probe)
      if (parent === probe) {
        return {
          ok: false,
          reason: `Path "${filePath}" resolves outside the working directory via a symlink`,
        }
      }
      probe = parent
    }
  }
}
