import { SandboxManager } from '@anthropic-ai/sandbox-runtime'
import { nativeSandbox } from './native'
import { unrestrictedSandbox } from './unrestricted'
import type { Sandbox } from './types'

const PANIC_TRUTHY = new Set([`1`, `true`, `yes`, `on`])

export interface ChooseDefaultSandboxOpts {
  /** Override for testing — defaults to `SandboxManager.isSupportedPlatform()`. */
  isNativeSupported?: () => boolean
}

/**
 * Pick the right Sandbox provider for built-in entities given the current
 * platform and environment. Used by Horton/Worker to default to
 * `nativeSandbox` on macOS/Linux while keeping a panic-revert path.
 *
 * Selection:
 * - `ELECTRIC_AGENTS_UNRESTRICTED` env truthy (`1`/`true`/`yes`/`on`) →
 *   `unrestrictedSandbox`. Documented as the emergency switch when the
 *   native engine misbehaves.
 * - Native platform supported → `nativeSandbox`.
 * - Otherwise → `unrestrictedSandbox`.
 *
 * Customers wiring their own entities can call this directly, or
 * construct any specific provider themselves.
 */
export async function chooseDefaultSandbox(
  workingDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
  opts: ChooseDefaultSandboxOpts = {}
): Promise<Sandbox> {
  const panic = env.ELECTRIC_AGENTS_UNRESTRICTED
  if (panic && PANIC_TRUTHY.has(panic.toLowerCase())) {
    return unrestrictedSandbox({ workingDirectory })
  }
  const isSupported =
    opts.isNativeSupported ?? (() => SandboxManager.isSupportedPlatform())
  if (isSupported()) {
    return nativeSandbox({ workingDirectory })
  }
  return unrestrictedSandbox({ workingDirectory })
}
