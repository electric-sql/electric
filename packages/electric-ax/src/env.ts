import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

interface AnthropicApiKeyOptions {
  anthropicApiKey?: string
}

function parseDotEnvValue(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith(`"`) && trimmed.endsWith(`"`)) ||
    (trimmed.startsWith(`'`) && trimmed.endsWith(`'`))
  ) {
    return trimmed.slice(1, -1)
  }
  const hashIndex = trimmed.indexOf(`#`)
  return hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex).trim()
}

export function readDotEnvFile(
  cwd: string = process.cwd()
): Record<string, string> {
  const envPath = resolvePath(cwd, `.env`)

  try {
    const content = readFileSync(envPath, `utf8`)
    const values: Record<string, string> = {}

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(`#`)) {
        continue
      }

      const equalsIndex = trimmed.indexOf(`=`)
      if (equalsIndex <= 0) {
        continue
      }

      const key = trimmed.slice(0, equalsIndex).trim()
      const value = parseDotEnvValue(trimmed.slice(equalsIndex + 1))
      values[key] = value
    }

    return values
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === `ENOENT`) {
      return {}
    }
    throw error
  }
}

export function resolveAnthropicApiKey(
  options: AnthropicApiKeyOptions,
  env: NodeJS.ProcessEnv = process.env,
  fileEnv: Record<string, string> = readDotEnvFile()
): string {
  const candidate =
    options.anthropicApiKey?.trim() ||
    env.ANTHROPIC_API_KEY?.trim() ||
    fileEnv.ANTHROPIC_API_KEY?.trim()

  if (!candidate) {
    throw new Error(
      `ANTHROPIC_API_KEY is required. Pass --anthropic-api-key, export it in your shell, or set it in .env.`
    )
  }

  return candidate
}
