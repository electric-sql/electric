export interface PreambleFields {
  description?: string
  whenToUse?: string
  keywords?: Array<string>
  arguments?: Array<string>
  argumentHint?: string
  userInvocable?: boolean
  max?: number
}

export function parsePreamble(content: string): PreambleFields {
  const lines = content.split(`\n`)
  if (lines[0]?.trim() !== `---`) return {}

  let closingIndex = -1
  for (let i = 1; i < Math.min(lines.length, 25); i++) {
    if (lines[i]?.trim() === `---`) {
      closingIndex = i
      break
    }
  }
  if (closingIndex === -1) return {}

  const result: PreambleFields = {}
  for (let i = 1; i < closingIndex; i++) {
    const line = lines[i]!
    const colonIndex = line.indexOf(`:`)
    if (colonIndex === -1) continue

    const key = line.slice(0, colonIndex).trim()
    const rawValue = line.slice(colonIndex + 1).trim()

    switch (key) {
      case `description`:
        result.description = stripQuotes(rawValue)
        break
      case `whenToUse`:
        result.whenToUse = stripQuotes(rawValue)
        break
      case `keywords`: {
        if (rawValue.length === 0) {
          // Multi-line YAML list: collect subsequent `  - value` lines
          const items: Array<string> = []
          for (let j = i + 1; j < closingIndex; j++) {
            const next = lines[j]!
            const match = next.match(/^\s+-\s+(.+)$/)
            if (match) {
              items.push(match[1]!.trim())
              i = j // advance outer loop past consumed lines
            } else {
              break
            }
          }
          result.keywords = items
        } else {
          result.keywords = parseKeywords(rawValue)
        }
        break
      }
      case `arguments`: {
        if (rawValue.length === 0) {
          const items: Array<string> = []
          for (let j = i + 1; j < closingIndex; j++) {
            const next = lines[j]!
            const match = next.match(/^\s+-\s+(.+)$/)
            if (match) {
              items.push(match[1]!.trim())
              i = j
            } else {
              break
            }
          }
          result.arguments = items
        } else {
          result.arguments = parseKeywords(rawValue)
        }
        break
      }
      case `argument-hint`:
        result.argumentHint = stripQuotes(rawValue)
        break
      case `user-invocable`:
        result.userInvocable = rawValue === `true`
        break
      case `max`: {
        const num = parseInt(rawValue, 10)
        if (!Number.isNaN(num) && num > 0) result.max = num
        break
      }
    }
  }

  return result
}

function parseKeywords(raw: string): Array<string> {
  const stripped = raw.replace(/^\[/, ``).replace(/\]$/, ``)
  return stripped
    .split(`,`)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith(`"`) && value.endsWith(`"`)) {
    return value.slice(1, -1)
  }
  return value
}
