import type {
  BuiltinAgentsServer,
  BuiltinModelProvider,
  McpServerConfig,
  RegistrySnapshot,
} from '@electric-ax/agents'
import type {
  OpenAIRealtimeReasoningEffort,
  RealtimeModelChoice,
  RealtimeReasoningEffortChoice,
  RealtimeVoiceChoice,
} from '@electric-ax/agents-runtime'

export type ServerSource = `manual` | `local-discovery` | `electric-cloud`
export type ServerDesiredState = `connected` | `disconnected`

export type ConnectServerOptions = {
  localRuntimeEnabled?: boolean
}

export type ServerConfig = {
  id: string
  name: string
  url: string
  source: ServerSource
  desiredState: ServerDesiredState
  localRuntimeEnabled: boolean
  headers?: Record<string, string>
  /**
   * For `source: 'electric-cloud'` only: the `stream_services.id` the
   * cloud-agents-server uses to identify this tenant. The matching agents
   * bearer token lives in `SecretStore` keyed by tenant id
   * (`cloud-agents-token:<tenantId>`), not in `settings.json`.
   */
  tenantId?: string
}

export type ServerConnectionStatus =
  | `disconnected`
  | `connecting`
  | `connected`
  | `reconnecting`
  | `offline`
  | `error`

export type DesktopRuntimeStatus = `stopped` | `starting` | `running` | `error`

export type LocalRuntimeStatus =
  | `disabled`
  | `stopped`
  | `starting`
  | `running`
  | `error`

export type DiscoveredServer = {
  url: string
  port: number
  /** Epoch ms - when we last saw a healthy `/_electric/health` response. */
  lastSeen: number
}

export type DesktopState = {
  servers: Array<ServerConfig>
  selectedServerId: string | null
  connections: Array<ServerConnectionState>
  runtimeStatus: DesktopRuntimeStatus
  runtimeUrl: string | null
  activeServer: ServerConfig | null
  workingDirectory: string | null
  error: string | null
  discoveredServers: Array<DiscoveredServer>
  pullWakeRunnerId: string | null
  credentialsRestartPending: boolean
}

export type DesktopServerFetchRequest = {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

export type DesktopServerFetchResponse = {
  url: string
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export type ServerConnectionState = {
  serverId: string
  status: ServerConnectionStatus
  localRuntimeStatus: LocalRuntimeStatus
  runtimeUrl: string | null
  runtimeError: string | null
  lastError: string | null
  reconnectAttempt: number
  lastConnectedAt: number | null
}

export type ApiKeys = {
  anthropic: string | null
  openai: string | null
  deepseek: string | null
  moonshot: string | null
  brave: string | null
  e2b: string | null
}

export type ModelPickerChoice = {
  provider: BuiltinModelProvider
  providerLabel: string
  id: string
  label: string
  value: string
}

export type ModelPickerStatus = {
  choices: Array<ModelPickerChoice>
  enabled: Array<string>
}

export type CodexAuthSource = `desktop-oauth` | `codex-cli` | `opencode`

export type CodexSettings = {
  enabled: boolean
  source: CodexAuthSource | null
}

export type RealtimeProvider = `openai`

export type RealtimeSettings = {
  provider: RealtimeProvider
  model: string
  voice: string
  reasoningEffort: OpenAIRealtimeReasoningEffort
  interruptResponse: boolean
}

export type RealtimeCredentialStatus =
  | `missing`
  | `valid`
  | `invalid`
  | `unknown`

export type RealtimeSettingsStatus = {
  settings: RealtimeSettings
  availableModels: Array<RealtimeModelChoice>
  availableVoices: Array<RealtimeVoiceChoice>
  availableReasoningEfforts: Array<RealtimeReasoningEffortChoice>
  hasOpenAIApiKey: boolean
  openAIApiKeyStatus: RealtimeCredentialStatus
  openAIApiKeyError?: string
  codexEnabled: boolean
}

export type DesktopSettings = {
  servers: Array<ServerConfig>
  defaultServerId: string | null
  workingDirectory: string | null
  apiKeysRef: string
  launchAtLogin?: boolean
  preventAppSuspension?: boolean
  codex?: CodexSettings
  enabledModelValues?: Array<string>
  realtime?: RealtimeSettings
  onboardingDismissed?: boolean
  mcp?: { servers: Array<McpServerConfig> }
  seededDefaultMcpServerNames?: Array<string>
  pullWakeRunnerId?: string
  pullWakeRunnerLabel?: string
}

export type LaunchAtLoginStatus = {
  supported: boolean
  enabled: boolean
  reason: string | null
}

export type PreventAppSuspensionPreference = boolean

export type ElectricCliInstallKind =
  | `not-installed`
  | `managed`
  | `manual`
  | `shadowed`
  | `broken`

export type ElectricCliStatus = {
  kind: ElectricCliInstallKind
  command: `electric`
  path: string | null
  version: string | null
  bundledVersion: string
  managedPath: string | null
  installDir: string
  installDirOnPath: boolean
  error: string | null
}

export type RuntimeEntry = {
  serverId: string
  desiredState: ServerDesiredState
  status: ServerConnectionStatus
  localRuntimeStatus: LocalRuntimeStatus
  runtime: BuiltinAgentsServer | null
  runtimeUrl: string | null
  runtimeError: string | null
  reconnectTimer: NodeJS.Timeout | null
  reconnectAttempt: number
  generation: number
  lastError: string | null
  lastConnectedAt: number | null
  mcpUnsubscribe: (() => void) | null
}

export type ApiKeysStatus = {
  hasAnyKey: boolean
  saved: ApiKeys
  suggested: ApiKeys
  codex: CodexStatus
  modelPicker: ModelPickerStatus
}

export type CodexDetectedSource = {
  source: CodexAuthSource
  label: string
  accountId: string | null
  email: string | null
  expiresAt: number | null
}

export type CodexStatus = {
  enabled: boolean
  source: CodexAuthSource | null
  availableSources: Array<CodexDetectedSource>
  accountId: string | null
  email: string | null
  expiresAt: number | null
  error: string | null
}

export type OnboardingState = {
  dismissed: boolean
  hasAnyKey: boolean
  signedIn: boolean
}

export type DesktopCommand =
  | `new-chat`
  | `close-tile`
  | `toggle-sidebar`
  | `open-settings`
  | `open-servers-settings`
  | `open-search`
  | `open-find`
  | `find-next`
  | `find-previous`
  | `split-right`
  | `split-down`
  | `cycle-tile`

export type DesktopMenuSection = `File` | `Edit` | `View` | `Window` | `Help`

export type DesktopMenuPopupBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type DesktopMenuState = {
  hasActiveTile: boolean
  canCloseTile: boolean
  canSplitTile: boolean
  canCycleTile: boolean
}

export type DesktopNavigationState = {
  canGoBack: boolean
  canGoForward: boolean
}

export type DesktopAppearance = `light` | `dark` | `system`

export type DesktopContextMenuRequest = {
  kind: `selection`
  selectionText: string
}

export type { McpServerConfig, RegistrySnapshot }

/**
 * Where an MCP server row in the snapshot came from:
 * - `settings` — the desktop's global `settings.json mcp.servers` block.
 * - `workspace` — the workspace's `mcp.json` file.
 * - `extras` — programmatic extras passed by another embedder (not the
 *   desktop). Unused on the desktop today, kept for completeness.
 */
export type McpServerProvenance = `settings` | `workspace` | `extras`

/**
 * UI-friendly row shape broadcast from the desktop main process. Includes
 * the registry-driven runtime fields plus provenance + shadowing so the
 * renderer can gate per-row affordances (Edit/Remove only on `settings`
 * rows, gray out `shadowed` rows where workspace `mcp.json` wins, etc).
 */
export interface DesktopMcpServerRow {
  name: string
  status:
    | `connecting`
    | `authenticating`
    | `ready`
    | `error`
    | `disabled`
    | `shadowed`
  toolCount: number
  transport?: string
  url?: string
  authMode?: string
  authUrl?: string
  error?: { kind: string; message: string }
  tools?: Array<{ name: string; description?: string }>
  provenance: McpServerProvenance
  /** True iff a settings.json entry is overridden by a workspace mcp.json one. */
  shadowed: boolean
  /**
   * Original config object — only populated for `provenance === 'settings'`
   * rows so the renderer's Edit form can pre-fill. Workspace and extras
   * rows omit this since they're read-only in the UI anyway.
   */
  config?: McpServerConfig
}

export interface DesktopMcpSnapshot {
  seq: number
  servers: ReadonlyArray<DesktopMcpServerRow>
}
