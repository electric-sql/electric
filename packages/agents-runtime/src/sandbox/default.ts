import { unrestrictedSandbox } from './unrestricted'
import type { Sandbox } from './types'

/**
 * Pick the default Sandbox provider for built-in entities (Horton, Worker).
 * Always returns `unrestrictedSandbox`; stronger isolation is opt-in by
 * constructing `dockerSandbox` or `remoteSandbox` directly.
 *
 * The unrestricted provider shares the host filesystem and process namespace,
 * so it is a single-tenant, trusted-code default — NOT a containment boundary.
 * Tool-layer policy shrinks the blast radius (workspace + symlink-escape
 * containment on reads/writes; bash drops host env so secrets aren't trivially
 * dumped) but cannot stop host-level access (e.g. reading `/proc/<ppid>/environ`
 * for secrets) or SSRF from `fetch_url`. Use `dockerSandbox`/`remoteSandbox` to
 * actually contain untrusted or multi-tenant entities.
 */
export async function chooseDefaultSandbox(
  workingDirectory: string
): Promise<Sandbox> {
  return unrestrictedSandbox({ workingDirectory })
}
