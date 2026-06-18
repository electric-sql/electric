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

  return {
    description: preamble.description ?? humanize(name),
    whenToUse:
      preamble.whenToUse ?? `User asks about ${humanize(name).toLowerCase()}`,
    keywords: preamble.keywords ?? [name],
    max: preamble.max ?? DEFAULT_MAX,
  }
}

function humanize(name: string): string {
  return name.replace(/[-_]/g, ` `).replace(/\b\w/g, (c) => c.toUpperCase())
}
