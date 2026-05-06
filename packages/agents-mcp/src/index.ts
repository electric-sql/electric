export const VERSION = `0.1.0-experimental.0`
export const EXPERIMENTAL = true

let warned = false
function warnExperimental(): void {
  if (warned) return
  warned = true

  console.warn(
    `[@electric-ax/agents-mcp] EXPERIMENTAL — public surfaces may change without a deprecation cycle.`
  )
}
warnExperimental()

export * from './types'
export * from './credentials/types'
export { inMemoryCredentialStore } from './credentials/in-memory'
export { envCredentialStore } from './credentials/env'
export { fileCredentialStore } from './credentials/file'
export { osKeychainCredentialStore } from './credentials/os-keychain'
export { composedCredentialStore } from './credentials/composed'
