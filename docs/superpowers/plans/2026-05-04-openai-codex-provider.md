# OpenAI Codex Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex models (GPT-5.1–5.5) available in the built-in agents model dropdown when the user has a valid `~/.codex/auth.json`.

**Architecture:** Extend the existing `BuiltinModelProvider` union and `configuredProviders()` in `model-catalog.ts` to detect Codex credentials. Deliver the access token via the existing `getApiKey` callback that pi-ai's runtime already supports.

**Tech Stack:** TypeScript, pi-ai (already a dependency — has `openai-codex` models and `KnownProvider`), Node.js fs/os for reading the auth file.

---

## File Structure

| File                                   | Action | Responsibility                                                               |
| -------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| `packages/agents/src/model-catalog.ts` | Modify | Add `openai-codex` provider detection, model listing, and `getApiKey` wiring |

That's it — single file change.

---

### Task 1: Add Codex Auth Detection

**Files:**

- Modify: `packages/agents/src/model-catalog.ts:1-61`

- [ ] **Step 1: Add imports and type**

Add `node:fs` and `node:os` imports, extend the `BuiltinModelProvider` type:

```ts
// At top of file, after existing imports:
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
```

Change line 4 from:

```ts
export type BuiltinModelProvider = `anthropic` | `openai`
```

to:

```ts
export type BuiltinModelProvider = `anthropic` | `openai` | `openai-codex`
```

- [ ] **Step 2: Add `codexAuthPath()` and `readCodexAccessToken()` helpers**

Add after the `hasEnv` function (after line 46):

```ts
function codexAuthPath(): string {
  return join(homedir(), `.codex`, `auth.json`)
}

function readCodexAccessToken(): string | undefined {
  try {
    const raw = readFileSync(codexAuthPath(), `utf-8`)
    const data = JSON.parse(raw) as {
      auth_mode?: string
      tokens?: { access_token?: string }
    }
    if (data.auth_mode !== `chatgpt`) return undefined
    const token = data.tokens?.access_token?.trim()
    return token && token.length > 0 ? token : undefined
  } catch {
    return undefined
  }
}

function hasCodexAuth(): boolean {
  if (!existsSync(codexAuthPath())) return false
  return readCodexAccessToken() !== undefined
}
```

- [ ] **Step 3: Update `configuredProviders()`**

Change from:

```ts
function configuredProviders(): Array<BuiltinModelProvider> {
  const providers: Array<BuiltinModelProvider> = []
  if (hasEnv(`ANTHROPIC_API_KEY`)) providers.push(`anthropic`)
  if (hasEnv(`OPENAI_API_KEY`)) providers.push(`openai`)
  return providers
}
```

to:

```ts
function configuredProviders(): Array<BuiltinModelProvider> {
  const providers: Array<BuiltinModelProvider> = []
  if (hasEnv(`ANTHROPIC_API_KEY`)) providers.push(`anthropic`)
  if (hasEnv(`OPENAI_API_KEY`)) providers.push(`openai`)
  if (hasCodexAuth()) providers.push(`openai-codex`)
  return providers
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/agents && npx tsc --noEmit 2>&1 | head -20`
Expected: Type errors about `providerLabel` or `fetchAvailableModelIds` not handling `openai-codex` — that's fine, we fix those in Task 2.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/model-catalog.ts
git commit -m "feat(agents): detect openai-codex credentials from ~/.codex/auth.json"
```

---

### Task 2: Model Listing and Provider Label

**Files:**

- Modify: `packages/agents/src/model-catalog.ts:48-127`

- [ ] **Step 1: Update `providerLabel()`**

Change from:

```ts
function providerLabel(provider: BuiltinModelProvider): string {
  return provider === `anthropic` ? `Anthropic` : `OpenAI`
}
```

to:

```ts
function providerLabel(provider: BuiltinModelProvider): string {
  if (provider === `anthropic`) return `Anthropic`
  if (provider === `openai-codex`) return `OpenAI Codex`
  return `OpenAI`
}
```

- [ ] **Step 2: Update `choicesForProvider()` to skip availability fetch for codex**

Change from:

```ts
async function choicesForProvider(
  provider: BuiltinModelProvider
): Promise<Array<BuiltinModelChoice>> {
  const knownModels = getModels(provider)
  const availableIds = await fetchAvailableModelIds(provider)
  const models =
    availableIds === null
      ? knownModels
      : knownModels.filter((model) => availableIds.has(model.id))

  return models.map((model) => ({
    provider,
    id: model.id,
    label: `${providerLabel(provider)} ${model.name}`,
    value: modelValue(provider, model.id),
    reasoning: model.reasoning,
  }))
}
```

to:

```ts
async function choicesForProvider(
  provider: BuiltinModelProvider
): Promise<Array<BuiltinModelChoice>> {
  const knownModels = getModels(provider)

  if (provider === `openai-codex`) {
    return knownModels.map((model) => ({
      provider,
      id: model.id,
      label: `${providerLabel(provider)} ${model.name}`,
      value: modelValue(provider, model.id),
      reasoning: model.reasoning,
    }))
  }

  const availableIds = await fetchAvailableModelIds(provider)
  const models =
    availableIds === null
      ? knownModels
      : knownModels.filter((model) => availableIds.has(model.id))

  return models.map((model) => ({
    provider,
    id: model.id,
    label: `${providerLabel(provider)} ${model.name}`,
    value: modelValue(provider, model.id),
    reasoning: model.reasoning,
  }))
}
```

- [ ] **Step 3: Update default model fallback in `createBuiltinModelCatalog()`**

Change the `defaultChoice` resolution (around line 187) from:

```ts
const defaultChoice =
  choices.find(
    (choice) =>
      choice.provider === `anthropic` && choice.id === DEFAULT_ANTHROPIC_MODEL
  ) ??
  choices.find(
    (choice) =>
      choice.provider === `openai` && choice.id === DEFAULT_OPENAI_MODEL
  ) ??
  choices[0]!
```

to:

```ts
const defaultChoice =
  choices.find(
    (choice) =>
      choice.provider === `anthropic` && choice.id === DEFAULT_ANTHROPIC_MODEL
  ) ??
  choices.find(
    (choice) =>
      choice.provider === `openai` && choice.id === DEFAULT_OPENAI_MODEL
  ) ??
  choices.find(
    (choice) =>
      choice.provider === `openai-codex` && choice.id === DEFAULT_CODEX_MODEL
  ) ??
  choices[0]!
```

Also add the constant near the top (after line 42):

```ts
const DEFAULT_CODEX_MODEL = `gpt-5.4`
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/agents && npx tsc --noEmit 2>&1 | head -20`
Expected: Clean or only errors related to `getApiKey` (Task 3).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/model-catalog.ts
git commit -m "feat(agents): list openai-codex models in catalog from pi-ai"
```

---

### Task 3: Wire getApiKey for Codex Token Delivery

**Files:**

- Modify: `packages/agents/src/model-catalog.ts:30-35,201-225`

- [ ] **Step 1: Add `getApiKey` to `BuiltinAgentModelConfig` type**

Change from:

```ts
export type BuiltinAgentModelConfig = Pick<
  AgentConfig,
  `model` | `provider` | `onPayload`
> & {
  reasoningEffort?: ExplicitReasoningEffort
}
```

to:

```ts
export type BuiltinAgentModelConfig = Pick<
  AgentConfig,
  `model` | `provider` | `onPayload` | `getApiKey`
> & {
  reasoningEffort?: ExplicitReasoningEffort
}
```

- [ ] **Step 2: Update `resolveBuiltinModelConfig()` to attach `getApiKey` for codex**

In the `resolveBuiltinModelConfig` function, change from:

```ts
const choice = selected ?? catalog.defaultChoice
const config = {
  provider: choice.provider,
  model: choice.id,
  ...(reasoningEffort && { reasoningEffort }),
}

return withProviderPayloadDefaults(config, choice, reasoningEffort)
```

to:

```ts
const choice = selected ?? catalog.defaultChoice
const config: PersistedModelConfig & { getApiKey?: AgentConfig[`getApiKey`] } =
  {
    provider: choice.provider,
    model: choice.id,
    ...(reasoningEffort && { reasoningEffort }),
    ...(choice.provider === `openai-codex` && {
      getApiKey: (provider: string) => {
        if (provider !== `openai-codex`) return undefined
        return readCodexAccessToken()
      },
    }),
  }

return withProviderPayloadDefaults(config, choice, reasoningEffort)
```

- [ ] **Step 3: Update `withProviderPayloadDefaults` signature to pass through `getApiKey`**

The `withProviderPayloadDefaults` function takes a `PersistedModelConfig` and returns `BuiltinAgentModelConfig`. Since `BuiltinAgentModelConfig` now includes `getApiKey`, and the input config may have it, update the input type. Change from:

```ts
function withProviderPayloadDefaults(
  config: PersistedModelConfig,
  choice: BuiltinModelChoice,
  reasoningEffort: ExplicitReasoningEffort | null
): BuiltinAgentModelConfig {
  if (choice.provider !== `openai` || !choice.reasoning) return config
```

to:

```ts
function withProviderPayloadDefaults(
  config: PersistedModelConfig & { getApiKey?: AgentConfig[`getApiKey`] },
  choice: BuiltinModelChoice,
  reasoningEffort: ExplicitReasoningEffort | null
): BuiltinAgentModelConfig {
  if (choice.provider !== `openai` || !choice.reasoning) return config
```

- [ ] **Step 4: Verify TypeScript compiles clean**

Run: `cd packages/agents && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/model-catalog.ts
git commit -m "feat(agents): wire getApiKey for openai-codex token delivery"
```

---

### Task 4: Verify End-to-End

- [ ] **Step 1: Confirm `~/.codex/auth.json` exists on this machine**

Run: `test -f ~/.codex/auth.json && echo "exists" || echo "missing"`
Expected: `exists`

- [ ] **Step 2: Build the agents package**

Run: `cd packages/agents && pnpm build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 3: Run existing tests to check for regressions**

Run: `cd packages/agents && pnpm test 2>&1 | tail -20`
Expected: All existing tests pass (no test file changes needed — existing tests mock providers or use env vars).

- [ ] **Step 4: Quick smoke test — verify codex models appear in catalog**

Run a quick inline script:

```bash
cd packages/agents && node -e "
import('./src/model-catalog.ts')
" 2>&1 | head -5
```

If that doesn't work with TS directly, verify via the build output or by checking `tsc --noEmit` passes. The real integration test is starting the agents server with `~/.codex/auth.json` present and seeing models in the dropdown.

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add -A packages/agents/src/model-catalog.ts
git commit -m "fix(agents): address any type or build issues from codex provider"
```

Only commit if there were fixes. Skip if clean.
