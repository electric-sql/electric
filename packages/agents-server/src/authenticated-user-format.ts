import type { Principal } from './principal.js'

export function formatRequestPrincipal(
  principal: Principal | null | undefined
): string | undefined {
  return principal?.key
}
