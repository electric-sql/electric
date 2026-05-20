import { completeWithLowCostModel } from '../model-runner'
import { runtimeLog } from '../log'
import { parsePreamble } from './preamble'

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

  try {
    return await llmExtract(name, content, preamble)
  } catch (err) {
    runtimeLog.warn(
      `[skills]`,
      `LLM metadata extraction failed for "${name}":`,
      err instanceof Error ? err : new Error(String(err))
    )
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

  const text = await completeWithLowCostModel({
    purpose: `skill metadata extraction`,
    systemPrompt: `Extract metadata from skill documents. Return only valid JSON that matches the requested schema.`,
    prompt,
    maxTokens: 256,
    log: (message) => runtimeLog.info(`[skills]`, message),
    logPrefix: `[skills]`,
  })

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
