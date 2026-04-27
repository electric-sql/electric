import Anthropic from '@anthropic-ai/sdk'
import { serverLog } from '../log'
import { parsePreamble } from './preamble'

const EXTRACT_MODEL = `claude-haiku-4-5-20251001`

interface ExtractedMeta {
  description: string
  whenToUse: string
  keywords: Array<string>
  arguments?: Array<string>
  argumentHint?: string
  userInvocable?: boolean
  max: number
}

const DEFAULT_MAX = 10_000

export async function extractSkillMeta(
  name: string,
  content: string
): Promise<ExtractedMeta> {
  const preamble = parsePreamble(content)

  if (preamble.description && preamble.whenToUse && preamble.keywords) {
    return {
      description: preamble.description,
      whenToUse: preamble.whenToUse,
      keywords: preamble.keywords,
      ...(preamble.arguments && { arguments: preamble.arguments }),
      ...(preamble.argumentHint && { argumentHint: preamble.argumentHint }),
      ...(preamble.userInvocable && { userInvocable: true }),
      max: preamble.max ?? DEFAULT_MAX,
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await llmExtract(name, content, preamble)
    } catch (err) {
      serverLog.warn(
        `[skills] LLM metadata extraction failed for "${name}": ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return {
    description: preamble.description ?? humanize(name),
    whenToUse:
      preamble.whenToUse ?? `User asks about ${humanize(name).toLowerCase()}`,
    keywords: preamble.keywords ?? [name],
    max: preamble.max ?? DEFAULT_MAX,
  }
}

async function llmExtract(
  name: string,
  content: string,
  partial: {
    description?: string
    whenToUse?: string
    keywords?: Array<string>
    max?: number
  }
): Promise<ExtractedMeta> {
  const client = new Anthropic()
  const truncated = content.slice(0, 8_000)

  const prompt = `Analyze this skill document and extract metadata. The skill is named "${name}".

<skill>
${truncated}
</skill>

Return ONLY a JSON object with these fields:
- "description": one-line summary of what this skill provides (max 100 chars)
- "whenToUse": when should an AI agent load this skill (max 200 chars)
- "keywords": array of 3-8 relevant keywords

Return raw JSON, no markdown fences.`

  const res = await client.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 256,
    messages: [{ role: `user`, content: prompt }],
  })

  const text = res.content[0]?.type === `text` ? res.content[0].text : ``
  const parsed = JSON.parse(text)

  return {
    description: partial.description ?? parsed.description ?? humanize(name),
    whenToUse:
      partial.whenToUse ?? parsed.whenToUse ?? `User asks about ${name}`,
    keywords: partial.keywords ?? parsed.keywords ?? [name],
    max: partial.max ?? DEFAULT_MAX,
  }
}

function humanize(name: string): string {
  return name.replace(/[-_]/g, ` `).replace(/\b\w/g, (c) => c.toUpperCase())
}
