import { posix } from 'node:path'

/**
 * Path containment shared by the *isolated* providers (docker container, remote
 * VM). Sandbox paths are always POSIX — they name locations inside the
 * container / VM, independent of the host platform — so resolution is done with
 * `posix` regardless of where the runtime runs.
 *
 * NOTE: this is a STRING-level containment check, not a symlink-resolving one;
 * it relies on the container / VM boundary for actual isolation. The
 * unrestricted provider, which shares the host filesystem, deliberately uses a
 * stricter realpath/symlink walk instead (see `unrestricted.ts`) and must not
 * be routed through here.
 */

/** Resolve a user-supplied `path` against `workingDirectory` to an absolute posix path. */
export function absoluteSandboxPath(
  workingDirectory: string,
  path: string
): string {
  return path.startsWith(`/`) ? path : posix.resolve(workingDirectory, path)
}

/**
 * Whether `path` resolves to a location inside `workingDirectory` — the
 * containment boundary the isolated providers enforce on writes (and, for
 * docker, reads).
 */
export function isPathWithinSandbox(
  workingDirectory: string,
  path: string
): boolean {
  const rel = posix.relative(
    workingDirectory,
    absoluteSandboxPath(workingDirectory, path)
  )
  return !rel.startsWith(`..`) && rel !== `..`
}
