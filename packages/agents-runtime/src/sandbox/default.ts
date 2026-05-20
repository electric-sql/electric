import { unrestrictedSandbox } from './unrestricted'
import type { Sandbox } from './types'

/**
 * Pick the default Sandbox provider for built-in entities (Horton, Worker).
 * Always returns `unrestrictedSandbox`; stronger isolation is opt-in by
 * constructing `dockerSandbox` or `remoteSandbox` directly. Tool-layer
 * policy (env scrubbing, symlink resolution, fetch SSRF guards) provides
 * the in-process defenses for the unrestricted default.
 */
export async function chooseDefaultSandbox(
  workingDirectory: string
): Promise<Sandbox> {
  return unrestrictedSandbox({ workingDirectory })
}
