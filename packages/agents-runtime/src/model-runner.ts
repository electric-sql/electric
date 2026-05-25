import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { completeSimple, getModel } from '@mariozechner/pi-ai'
import type { AgentConfig } from './types'
import type { KnownProvider } from '@mariozechner/pi-ai'

export interface LowCostModelChoice {
  provider: KnownProvider | string
  id: string
  reasoning?: boolean
}

export interface LowCostModelCatalog {
  choices: Array<LowCostModelChoice>
  defaultChoice?: LowCostModelChoice
}

export type LowCostModelConfig = Pick<
  AgentConfig,
  `model` | `provider` | `getApiKey`
>

const PREFERRED_IDS_BY_PROVIDER: Record<string, Array<string>> = {
  anthropic: [`claude-3-5-haiku-latest`, `claude-3-5-haiku-20241022`],
  openai: [`gpt-4.1-nano`, `gpt-4o-mini`, `gpt-4.1-mini`],
  'openai-codex': [`gpt-5.4-mini`, `gpt-5.1-codex-mini`],
  deepseek: [`deepseek-v4-flash`, `deepseek-v4-pro`],
}

function hasEnv(name: string): boolean {
  return (process.env[name]?.trim().length ?? 0) > 0
}

function codexAuthPath(): string {
  return process.env.CODEX_AUTH_PATH ?? join(homedir(), `.codex`, `auth.json`)
}

export function readCodexAccessToken(): string | undefined {
  try {
    const raw = readFileSync(codexAuthPath(), `utf-8`)
    const data = JSON.parse(raw) as {
      auth_mode?: string
      tokens?: { access_token?: string }
    }
    if (data.auth_mode !== `chatgpt`) return undefined
    return data.tokens?.access_token?.trim() || undefined
  } catch {
    return undefined
  }
}

export type AvailableProvider =
  | `anthropic`
  | `openai`
  | `openai-codex`
  | `deepseek`

export function detectAvailableProviders(): Array<AvailableProvider> {
  const providers: Array<AvailableProvider> = []
  if (hasEnv(`ANTHROPIC_API_KEY`)) providers.push(`anthropic`)
  if (hasEnv(`OPENAI_API_KEY`)) providers.push(`openai`)
  if (hasEnv(`DEEPSEEK_API_KEY`)) providers.push(`deepseek`)
  if (readCodexAccessToken() !== undefined) providers.push(`openai-codex`)
  return providers
}

function envCatalog(): LowCostModelCatalog {
  const choices: Array<LowCostModelChoice> = []
  const providers = detectAvailableProviders()
  if (providers.includes(`openai`)) {
    choices.push({ provider: `openai`, id: `gpt-4.1-nano`, reasoning: false })
  }
  if (providers.includes(`anthropic`)) {
    choices.push({
      provider: `anthropic`,
      id: `claude-3-5-haiku-latest`,
      reasoning: false,
    })
  }
  if (providers.includes(`openai-codex`)) {
    choices.push({
      provider: `openai-codex`,
      id: `gpt-5.4-mini`,
      reasoning: false,
    })
  }
  if (providers.includes(`deepseek`)) {
    // pi-ai marks deepseek-v4-flash as reasoning:true (it supports extended
    // thinking). We mirror that here so completeWithLowCostModel forwards the
    // reasoning flag to the provider correctly, even though this means short
    // low-cost calls (e.g. title generation) will pay a small reasoning-token
    // overhead when DeepSeek is the only configured provider. A non-reasoning
    // DeepSeek SKU should be preferred here once pi-ai exposes one.
    choices.push({
      provider: `deepseek`,
      id: `deepseek-v4-flash`,
      reasoning: true,
    })
  }
  return { choices, defaultChoice: choices[0] }
}

export function selectLowCostModelChoice(
  catalog: LowCostModelCatalog = envCatalog(),
  modelConfig: LowCostModelConfig = { model: `claude-3-5-haiku-latest` }
): LowCostModelChoice {
  const configuredProvider =
    modelConfig.provider ?? catalog.defaultChoice?.provider
  const providerOrder = [
    configuredProvider,
    `openai`,
    `anthropic`,
    `deepseek`,
  ].filter((provider): provider is string => Boolean(provider))

  for (const provider of providerOrder) {
    for (const id of PREFERRED_IDS_BY_PROVIDER[provider] ?? []) {
      const choice = catalog.choices.find(
        (candidate) => candidate.provider === provider && candidate.id === id
      )
      if (choice) return choice
    }

    const nonReasoningChoice = catalog.choices.find(
      (candidate) =>
        candidate.provider === provider && candidate.reasoning === false
    )
    if (nonReasoningChoice) return nonReasoningChoice
  }

  const configuredModel =
    typeof modelConfig.model === `string` ? modelConfig.model : undefined
  return (
    catalog.choices.find(
      (candidate) =>
        candidate.provider === configuredProvider &&
        candidate.id === configuredModel
    ) ??
    catalog.defaultChoice ??
    catalog.choices[0] ?? {
      provider: `anthropic`,
      id: `claude-3-5-haiku-latest`,
      reasoning: false,
    }
  )
}

export async function completeWithLowCostModel(input: {
  catalog?: LowCostModelCatalog
  modelConfig?: LowCostModelConfig
  log?: (message: string) => void
  logPrefix?: string
  purpose: string
  systemPrompt: string
  prompt: string
  maxTokens: number
}): Promise<string> {
  const choice = selectLowCostModelChoice(input.catalog, input.modelConfig)
  const model = getModel(
    choice.provider as Parameters<typeof getModel>[0],
    choice.id as Parameters<typeof getModel>[1]
  )
  if (!model) {
    throw new Error(
      `unknown ${input.purpose} model "${choice.id}" for provider "${choice.provider}"`
    )
  }

  input.log?.(
    `${input.logPrefix ?? ``}${input.logPrefix ? ` ` : ``}${input.purpose} using ${choice.provider}:${choice.id}`
  )

  const apiKey = input.modelConfig?.getApiKey
    ? await input.modelConfig.getApiKey(choice.provider)
    : undefined
  const res = await completeSimple(
    model,
    {
      systemPrompt: input.systemPrompt,
      messages: [
        { role: `user`, content: input.prompt, timestamp: Date.now() },
      ],
    },
    {
      maxTokens: choice.reasoning
        ? Math.max(input.maxTokens, 1024)
        : input.maxTokens,
      ...(choice.reasoning && { reasoning: `low` as const }),
      ...(apiKey && { apiKey }),
    }
  )
  const textBlock = res.content.find((block) => block.type === `text`)
  const text = textBlock && `text` in textBlock ? textBlock.text : undefined
  if (!text || text.trim().length === 0) {
    const contentTypes =
      res.content.map((block) => block.type).join(`,`) || `none`
    throw new Error(
      `empty LLM ${input.purpose} response from ${choice.provider}:${choice.id} stopReason=${res.stopReason} errorMessage=${res.errorMessage ?? `none`} contentTypes=${contentTypes}`
    )
  }
  return text
}
