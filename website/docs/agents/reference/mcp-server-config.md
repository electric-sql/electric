---
title: McpServerConfig
titleTemplate: "... - Electric Agents"
description: >-
  Schema reference for MCP server entries — transports, auth modes, and
  persistence callbacks accepted by Registry.addServer, applyConfig, and
  the mcp.json / settings.json layers.
outline: [2, 3]
---

# McpServerConfig

Shape of a server entry in the MCP registry. Identical between declarative (`mcp.json`, desktop `settings.json`) and programmatic (`Registry.addServer`) creation paths.

**Source:** `@electric-ax/agents` (re-exported from `@electric-ax/agents-mcp`)

```ts
type McpServerConfig = McpHttpServerConfig | McpStdioServerConfig
```

The variant is selected by the `transport` field.

## McpHttpServerConfig

Streamable HTTP transport per the current MCP spec.

```ts
interface McpHttpServerConfig {
  name: string
  transport: "http"
  url: string
  auth: McpAuthConfig
  timeoutMs?: number
}
```

| Field       | Type            | Required | Description                                                                  |
| ----------- | --------------- | -------- | ---------------------------------------------------------------------------- |
| `name`      | `string`        | Yes      | Stable identifier. Used as the keychain account, the IPC verb argument, and the `mcp__<name>__<tool>` tool prefix. |
| `transport` | `"http"`        | Yes      | Discriminator selecting the HTTP variant.                                    |
| `url`       | `string`        | Yes      | The MCP server's HTTPS endpoint. Streamable transport with SSE inside.       |
| `auth`      | `McpAuthConfig` | Yes      | One of the auth modes below. Use `{ mode: "none" }` for unauthenticated servers. |
| `timeoutMs` | `number`        | No       | Per-call timeout override. Default `30000` (30 seconds).                     |

## McpStdioServerConfig

Locally-spawned subprocess speaking the MCP stdio protocol.

```ts
interface McpStdioServerConfig {
  name: string
  transport: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  auth?: McpAuthConfig
  timeoutMs?: number
}
```

| Field       | Type                     | Required | Description                                                              |
| ----------- | ------------------------ | -------- | ------------------------------------------------------------------------ |
| `name`      | `string`                 | Yes      | Stable identifier (see HTTP variant).                                    |
| `transport` | `"stdio"`                | Yes      | Discriminator selecting the stdio variant.                               |
| `command`   | `string`                 | Yes      | Executable name or absolute path. Resolved against `PATH`.               |
| `args`      | `string[]`               | No       | CLI arguments. `${workspaceRoot}` is the only built-in expansion.        |
| `env`       | `Record<string, string>` | No       | Environment variables for the subprocess. Inherits the parent's `PATH`.  |
| `auth`      | `McpAuthConfig`          | No       | Typically `{ mode: "none" }`. Defaults to `none` when omitted.           |
| `timeoutMs` | `number`                 | No       | Per-call timeout override. Default `30000`.                              |

The subprocess is spawned lazily on the first tool call, kept alive across calls, and restarted on crash. One process per server, multiplexed via JSON-RPC `id`.

## McpAuthConfig

Discriminated union covering the four supported credential modes.

```ts
type McpAuthConfig =
  | { mode: "none" }
  | ApiKeyAuth
  | ClientCredentialsAuth
  | AuthorizationCodeAuth
```

### `none`

```ts
{ mode: "none" }
```

No authentication. Required for stdio servers that don't need credentials; rare for HTTP servers.

### `apiKey`

```ts
interface ApiKeyAuth {
  mode: "apiKey"
  key: string
  headerName?: string  // default "Authorization"
  valuePrefix?: string // e.g. "Bearer "
}
```

| Field         | Type     | Required | Description                                                                  |
| ------------- | -------- | -------- | ---------------------------------------------------------------------------- |
| `key`         | `string` | Yes      | Raw secret. Inline at the call site (e.g. `process.env.X_API_KEY`).          |
| `headerName`  | `string` | No       | HTTP header name. Defaults to `Authorization`.                               |
| `valuePrefix` | `string` | No       | Prepended to the key. Use `"Bearer "` for bearer tokens; empty for raw keys. |

### `clientCredentials`

OAuth 2.1 client-credentials grant. Unattended; no user interaction.

```ts
interface ClientCredentialsAuth {
  mode: "clientCredentials"
  tokenUrl: string
  clientId: string
  clientSecret: string
  scopes?: string[]
  audience?: string
  resource?: string
}
```

| Field          | Type       | Required | Description                                                                 |
| -------------- | ---------- | -------- | --------------------------------------------------------------------------- |
| `tokenUrl`     | `string`   | Yes      | OAuth token endpoint.                                                       |
| `clientId`     | `string`   | Yes      | Inline at the call site (e.g. `process.env.X_CLIENT_ID`).                   |
| `clientSecret` | `string`   | Yes      | Inline at the call site (e.g. `process.env.X_CLIENT_SECRET`).               |
| `scopes`       | `string[]` | No       | Requested OAuth scopes.                                                     |
| `audience`     | `string`   | No       | Auth0/OIDC `audience` claim, when the auth server requires it.              |
| `resource`     | `string`   | No       | RFC 8707 resource indicator.                                                |

The runtime exchanges the credentials for a short-lived access token, retries the exchange on 401, and never surfaces user-facing errors during steady state.

### `authorizationCode`

OAuth 2.1 authorization-code grant with PKCE. Requires a one-time browser flow per user.

```ts
interface AuthorizationCodeAuth {
  mode: "authorizationCode"
  scopes?: string[]
  resource?: string
  redirectUri?: string
  client?: OAuthClientInfo
  tokens?: OAuthTokens
  onTokensChanged?: (tokens: OAuthTokens) => void | Promise<void>
  onClientRegistered?: (client: OAuthClientInfo) => void | Promise<void>
  oauthProviderRef?: string
}
```

| Field                | Type                                          | Required | Description                                                                                                                              |
| -------------------- | --------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `scopes`             | `string[]`                                    | No       | Requested OAuth scopes.                                                                                                                  |
| `resource`           | `string`                                      | No       | RFC 8707 resource indicator.                                                                                                             |
| `redirectUri`        | `string`                                      | No       | Override the default `${publicUrl}/oauth/callback/<server>` sentinel. Most embedders don't need this.                                    |
| `client`             | `OAuthClientInfo`                             | No       | Pre-registered OAuth client (`client_id`, optional `client_secret`). When present, RFC 7591 Dynamic Client Registration is skipped.       |
| `tokens`             | `OAuthTokens`                                 | No       | Pre-existing tokens to seed the in-process cache. The OAuth flow is skipped on boot; refresh-token rotation still happens transparently. |
| `onTokensChanged`    | `(tokens) => void \| Promise<void>`           | No       | Fires after initial auth and on every refresh. Wire to a persistence layer if tokens should survive process restarts.                    |
| `onClientRegistered` | `(client) => void \| Promise<void>`           | No       | Fires once after RFC 7591 DCR completes. Pair with `client` on the next boot to skip DCR.                                                |
| `oauthProviderRef`   | `string`                                      | No       | Reference into a per-process map of pre-built `OAuthClientProvider` instances. Escape hatch for mTLS, OIDC quirks, etc.                  |

### `OAuthTokens`

```ts
interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number  // Unix seconds
}
```

### `OAuthClientInfo`

```ts
interface OAuthClientInfo {
  clientId: string
  clientSecret?: string
  // RFC 7591 metadata (issued_at, expires_at, redirect_uris, …)
  // — preserved verbatim from the DCR response.
  [key: string]: unknown
}
```

## Validation

`mcp.json` and programmatic configs are validated when first applied:

- `transport` must be `"http"` or `"stdio"`.
- `auth.mode` must be one of `none` / `apiKey` / `clientCredentials` / `authorizationCode`.
- `mcp.json` rejects forbidden reference keys (`clientIdRef`, `clientSecretRef`, `valueRef`, …) — secrets must be passed inline at the call site, not declared as references.
- Inline `${VAR}` placeholders in `mcp.json` are expanded against `process.env` before validation.

Invalid entries surface as `error`-state entries in `Registry.list()` with a structured `McpToolError`. The rest of the registry continues to operate.

## Persistence helpers

Two opt-in helpers from `@electric-ax/agents-mcp` produce auth-config slices that satisfy the persistence callback contract:

```ts
import { keychainPersistence, filePersistence } from "@electric-ax/agents-mcp"

const tokens = await keychainPersistence({ server: "honeycomb" })
// → { tokens?, client?, onTokensChanged, onClientRegistered }

await registry.addServer({
  name: "honeycomb",
  transport: "http",
  url: "https://mcp.honeycomb.io/mcp",
  auth: { mode: "authorizationCode", scopes: ["mcp:read"], ...tokens },
})
```

| Helper                              | Backing store                                                         | Notes                                                                |
| ----------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `keychainPersistence({ server })`   | macOS `security`, Linux `secret-tool`. Throws on Windows.             | Service `electric-agents`, accounts `tokens:<server>` / `client:<server>`. |
| `filePersistence({ path, server })` | Mode-`0600` JSON file. Refuses to read files with looser permissions. | Use for CI / containers without an OS keychain.                      |

## See also

- [MCP servers usage guide](/docs/agents/usage/mcp-servers) — programmatic, file-based, and desktop-settings paths end-to-end.
- [`McpRegistry`](/docs/agents/reference/mcp-registry) — the API that consumes this config (`addServer` / `applyConfig` / lifecycle).
- [`BuiltinAgentsServer`](/docs/agents/usage/embedded-builtins) — host options that affect MCP, including `extraMcpServers` and `openAuthorizeUrl`.
