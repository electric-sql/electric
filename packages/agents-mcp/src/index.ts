export const VERSION = `0.1.0`
export * from './types'
export { createMcpTools } from './tools'
export type { McpToolsHandle } from './tools'
export { createRegistry } from './registry'
export type { Registry, RegistryOpts, ServerEntry } from './registry'
export { createFileVault } from './vault/file-vault'
export type { KeyVault } from './vault/types'
export type { FileVaultOptions } from './vault/file-vault'
export { loadConfig, parseConfig } from './config/loader'
export type { McpConfig } from './config/loader'
export { watchConfig } from './config/watcher'
export { defaultTransportFactory } from './transports/factory'
export { TimeoutError, withTimeout } from './transports/timeout'
export { bridgeMcpTool } from './bridge/tool-bridge'
export type { BridgedTool, BridgeOpts } from './bridge/tool-bridge'
export {
  createOAuthCoordinator,
  createInMemoryTokenCache,
  AuthUnavailableError,
} from './auth/coordinator'
export type {
  OAuthCoordinator,
  TokenCache,
  CoordinatorOpts,
} from './auth/coordinator'
export type { TokenSet } from './auth/client-credentials'
export { discoverAuthServer } from './auth/discovery'
export type { AuthServerMetadata } from './auth/discovery'
export { registerClient } from './auth/dcr'
export type { RegisteredClient } from './auth/dcr'
export { createPendingAuthStore } from './auth/pending-auth'
export type { PendingAuth, PendingAuthStore } from './auth/pending-auth'
export {
  exchangeAuthorizationCode,
  buildAuthorizationUrl,
  refreshToken,
} from './auth/authorization-code'
export type { AuthRequest } from './auth/authorization-code'
export { exchangeClientCredentials } from './auth/client-credentials'
export { generatePkcePair, codeChallengeS256 } from './auth/pkce'
export { startDeviceFlow, pollDeviceFlow } from './auth/device-code'
export type { DeviceFlowStart } from './auth/device-code'
