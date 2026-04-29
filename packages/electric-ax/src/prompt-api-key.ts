import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { resolveAnthropicApiKey } from './env.js'

interface AnthropicApiKeyOptions {
  anthropicApiKey?: string
}

type AnthropicApiKeyValidator = (key: string) => Promise<void>

export interface PromptIO {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  isTTY: boolean
  cwd: string
  exit: (code: number) => never
  validateAnthropicApiKey?: AnthropicApiKeyValidator
}

const FRIENDLY_INTRO = `\n${[
  `Provide an Anthropic Claude key to connect Electric Agents to an LLM provider. Support for other LLM providers is coming soon.`,
  `Your API key never leaves your local computer. It's used by the agent entities installed by default in the Electric Agents runtime and by the example agents included in the quickstart template.`,
  `Paste the Anthropic key, or press Enter without typing a key to cancel and set it up manually in .env or pass --anthropic-api-key on the command line.`,
].join(`\n\n`)}\n\n`

function defaultPromptIO(): PromptIO {
  return {
    input: process.stdin,
    output: process.stdout,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    cwd: process.cwd(),
    exit: process.exit.bind(process) as (code: number) => never,
  }
}

export function parsePastedAnthropicApiKey(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(
    /^(?:export\s+)?ANTHROPIC_API_KEY\s*[:=]\s*(.*)$/s
  )
  const value = (match?.[1] ?? trimmed).trim()

  if (
    (value.startsWith(`"`) && value.endsWith(`"`)) ||
    (value.startsWith(`'`) && value.endsWith(`'`))
  ) {
    return value.slice(1, -1).trim()
  }

  return value
}

function assertAnthropicApiKeyPrefix(key: string): void {
  if (!key.startsWith(`sk-ant-`)) {
    throw new Error(
      `ANTHROPIC_API_KEY must look like an Anthropic API key (expected it to start with sk-ant-).`
    )
  }
}

export async function validateAnthropicApiKey(
  key: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): Promise<void> {
  let response: Response

  try {
    response = await fetchImpl(`https://api.anthropic.com/v1/models?limit=1`, {
      headers: {
        'anthropic-version': `2023-06-01`,
        'x-api-key': key,
      },
      signal: AbortSignal.timeout(5_000),
    })
  } catch (error) {
    throw new Error(
      `Could not validate ANTHROPIC_API_KEY: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (response.ok) {
    return
  }

  const body = await response.text()
  let detail = body.trim()
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    detail = parsed.error?.message ?? detail
  } catch {
    // Keep the raw response body when Anthropic does not return JSON.
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `ANTHROPIC_API_KEY validation failed: ${detail || response.statusText}`
    )
  }

  throw new Error(
    `Could not validate ANTHROPIC_API_KEY: Anthropic returned ${response.status}${detail ? ` (${detail})` : ``}`
  )
}

export async function ensureAnthropicApiKey(
  options: AnthropicApiKeyOptions,
  io: PromptIO = defaultPromptIO()
): Promise<string> {
  const validate = io.validateAnthropicApiKey ?? validateAnthropicApiKey
  const explicitKey = options.anthropicApiKey?.trim()
  let initialError: unknown

  if (explicitKey) {
    assertAnthropicApiKeyPrefix(explicitKey)
    await validate(explicitKey)
    return explicitKey
  }

  try {
    const key = resolveAnthropicApiKey(options)
    assertAnthropicApiKeyPrefix(key)
    await validate(key)
    return key
  } catch (error) {
    if (!io.isTTY) {
      throw error
    }
    initialError = error
  }

  io.output.write(FRIENDLY_INTRO)
  if (initialError) {
    io.output.write(`${formatValidationError(initialError)}\n\n`)
  }

  const rl = createInterface({ input: io.input, output: io.output })
  try {
    for (;;) {
      const pasted = await rl.question(`ANTHROPIC_API_KEY: `)
      const key = parsePastedAnthropicApiKey(pasted)

      if (!key) {
        io.output.write(
          `\nCancelled. Add ANTHROPIC_API_KEY=sk-ant-... to .env and re-run the command.\n\n`
        )
        io.exit(0)
        throw new Error(`unreachable`)
      }

      try {
        assertAnthropicApiKeyPrefix(key)
        await validate(key)
      } catch (error) {
        io.output.write(`${formatValidationError(error)}\n\n`)
        continue
      }

      const envPath = writeApiKeyToDotEnv(key, io.cwd)
      process.env.ANTHROPIC_API_KEY = key
      io.output.write(`\nSaved ANTHROPIC_API_KEY to ${envPath}\n\n`)
      return key
    }
  } finally {
    rl.close()
  }
}

function formatValidationError(error: unknown): string {
  return `Could not use that Anthropic key: ${error instanceof Error ? error.message : String(error)}`
}

function writeApiKeyToDotEnv(key: string, cwd: string): string {
  const envPath = resolvePath(cwd, `.env`)
  const newLine = `ANTHROPIC_API_KEY=${key}`

  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${newLine}\n`, `utf8`)
    return envPath
  }

  const existing = readFileSync(envPath, `utf8`)
  const replaced = existing.replace(/^ANTHROPIC_API_KEY=.*$/m, newLine)
  if (replaced !== existing) {
    writeFileSync(envPath, replaced, `utf8`)
    return envPath
  }

  const separator = existing.length === 0 || existing.endsWith(`\n`) ? `` : `\n`
  writeFileSync(envPath, `${existing}${separator}${newLine}\n`, `utf8`)
  return envPath
}
