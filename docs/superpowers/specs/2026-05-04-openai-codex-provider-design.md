# OpenAI Codex Provider — Read-only Interop with ~/.codex/auth.json

## Summary

Add `openai-codex` as a third built-in model provider in the agents model catalog. When a user has logged into OpenAI Codex CLI (`~/.codex/auth.json` exists with a valid token), Codex models (GPT-5.1 through GPT-5.5) automatically appear in the dashboard model dropdown alongside Anthropic and OpenAI API models.

No OAuth flow of our own. No token refresh. Read-only interop with Codex CLI's credential file.

## Scope

- **Package**: `packages/agents` (model-catalog.ts only, plus minor type change)
- **Not touched**: `packages/agents-runtime`, `packages/agents-server`

## Design

### Provider Detection

In `configuredProviders()`, add a check for `~/.codex/auth.json`:

```ts
export type BuiltinModelProvider = `anthropic` | `openai` | `openai-codex`

function configuredProviders(): Array<BuiltinModelProvider> {
  const providers: Array<BuiltinModelProvider> = []
  if (hasEnv(`ANTHROPIC_API_KEY`)) providers.push(`anthropic`)
  if (hasEnv(`OPENAI_API_KEY`)) providers.push(`openai`)
  if (hasCodexAuth()) providers.push(`openai-codex`)
  return providers
}
```

`hasCodexAuth()` reads `~/.codex/auth.json`, checks for `auth_mode === "chatgpt"` and a non-empty `tokens.access_token`. Uses `existsSync` + `readFileSync` with a try/catch (same style as the pi-ai CLI does it).

### Model Listing

For `openai-codex`, skip `fetchAvailableModelIds` (no list API exists). Use pi-ai's `getModels('openai-codex')` directly — same pattern as other providers, but without the availability filter.

```ts
async function choicesForProvider(provider: BuiltinModelProvider) {
  const knownModels = getModels(provider)

  // No model-list API for openai-codex; use full known set
  if (provider === 'openai-codex') {
    return knownModels.map(...)
  }

  const availableIds = await fetchAvailableModelIds(provider)
  // ... existing logic
}
```

### API Key (Token) Delivery

Extend `BuiltinAgentModelConfig` to include `getApiKey`:

```ts
export type BuiltinAgentModelConfig = Pick<
  AgentConfig,
  `model` | `provider` | `onPayload` | `getApiKey`
> & {
  reasoningEffort?: ExplicitReasoningEffort
}
```

When `provider === 'openai-codex'`, `resolveBuiltinModelConfig` returns a `getApiKey` function that reads the access token from `~/.codex/auth.json`:

```ts
getApiKey: (provider) => {
  if (provider !== 'openai-codex') return undefined
  return readCodexAccessToken() // reads tokens.access_token from ~/.codex/auth.json
}
```

This gets spread into `ctx.useAgent(...)` in both Horton and Worker — no changes needed in those files since they already spread the full modelConfig.

### Credential File Format

`~/.codex/auth.json`:

```json
{
  "auth_mode": "chatgpt",
  "OPENAI_API_KEY": null,
  "tokens": {
    "id_token": "...",
    "access_token": "...",
    "refresh_token": "...",
    "account_id": "..."
  },
  "last_refresh": "2026-05-04T..."
}
```

We read `tokens.access_token`. Nothing else.

### Error Behavior

| Condition                             | Result                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `~/.codex/auth.json` doesn't exist    | Provider not listed, no error                                                              |
| File exists but malformed/empty token | Provider not listed, `console.warn`                                                        |
| Token exists but API returns 401      | Runtime surfaces error naturally                                                           |
| Token expired (API returns 401)       | Runtime surfaces error; user sees "Run `codex` to refresh your login" in the error context |

### Provider Label

```ts
function providerLabel(provider: BuiltinModelProvider): string {
  if (provider === 'anthropic') return 'Anthropic'
  if (provider === 'openai') return 'OpenAI'
  return 'OpenAI Codex'
}
```

### Default Model Selection

If codex is the only configured provider, default to `gpt-5.4`. Otherwise, existing default priority (Anthropic > OpenAI > Codex) is preserved.

## Files Modified

1. `packages/agents/src/model-catalog.ts` — all changes live here:
   - Add `'openai-codex'` to `BuiltinModelProvider` type
   - Add `hasCodexAuth()` and `readCodexAccessToken()` helper functions
   - Update `configuredProviders()`
   - Update `choicesForProvider()` to skip availability fetch for codex
   - Update `providerLabel()`
   - Add `getApiKey` to `BuiltinAgentModelConfig` type
   - Update `resolveBuiltinModelConfig()` to attach `getApiKey` when provider is codex
   - Update default model fallback chain

## Not In Scope

- OAuth login flow (future: approach C from brainstorming)
- Token refresh / writing back to auth.json
- Changes to agents-runtime or agents-server
- CLI commands (`electric auth login` etc.)
- Dashboard UI changes beyond the model dropdown (it already renders whatever the catalog returns)
