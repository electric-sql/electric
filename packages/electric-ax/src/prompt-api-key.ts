import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { resolveAnthropicApiKey } from './env.js'

interface AnthropicApiKeyOptions {
  anthropicApiKey?: string
}

export interface PromptIO {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  isTTY: boolean
  cwd: string
  exit: (code: number) => never
}

const FRIENDLY_INTRO = [
  ``,
  `The Electric Agents quickstart requires setting an API key to connect to an LLM provider.`,
  ``,
  `Currently (in this initial developer preview release) the key must be an ANTHROPIC_API_KEY.`,
  `Support for other LLM providers is coming very soon.`,
  ``,
  `Note that your API key never leaves your local computer. It's used by the agent entities`,
  `installed by default in the Electric Agents runtime and by the example agents included`,
  `in the quickstart template.`,
  ``,
  `Would you like to:`,
  ``,
  `  1. manually setup a .env file with ANTHROPIC_API_KEY=...`,
  `  2. paste your api key into a prompt and we'll set it up for you`,
  ``,
].join(`\n`)

const MANUAL_SETUP_INSTRUCTIONS = [
  ``,
  `No problem. To finish setup:`,
  ``,
  `  1. Get a key from https://console.anthropic.com/settings/keys`,
  `  2. Add a line to your .env file:`,
  `         ANTHROPIC_API_KEY=sk-ant-...`,
  `  3. Re-run the command.`,
  ``,
].join(`\n`)

function defaultPromptIO(): PromptIO {
  return {
    input: process.stdin,
    output: process.stdout,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    cwd: process.cwd(),
    exit: process.exit.bind(process) as (code: number) => never,
  }
}

export async function ensureAnthropicApiKey(
  options: AnthropicApiKeyOptions,
  io: PromptIO = defaultPromptIO()
): Promise<string> {
  try {
    return resolveAnthropicApiKey(options)
  } catch (error) {
    if (!io.isTTY) {
      throw error
    }
  }

  io.output.write(FRIENDLY_INTRO)

  const rl = createInterface({ input: io.input, output: io.output })
  try {
    const choice = (await rl.question(`Enter 1/2: `)).trim()

    if (choice === `1`) {
      io.output.write(MANUAL_SETUP_INSTRUCTIONS)
      io.exit(0)
      throw new Error(`unreachable`)
    }

    if (choice === `2`) {
      const key = (await rl.question(`Paste your ANTHROPIC_API_KEY: `)).trim()
      if (!key) {
        throw new Error(
          `No API key provided. Re-run the command and try again.`
        )
      }
      const envPath = writeApiKeyToDotEnv(key, io.cwd)
      process.env.ANTHROPIC_API_KEY = key
      io.output.write(`\nSaved ANTHROPIC_API_KEY to ${envPath}\n\n`)
      return key
    }

    throw new Error(
      `Unrecognized choice ${JSON.stringify(choice)}. Please re-run the command and enter 1 or 2.`
    )
  } finally {
    rl.close()
  }
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
