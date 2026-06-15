export function approxTokens(value: unknown): number {
  if (typeof value === `string`) {
    return Math.floor(value.length / 4)
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, block) => {
      if (
        block &&
        typeof block === `object` &&
        `type` in block &&
        block.type === `text` &&
        `text` in block &&
        typeof block.text === `string`
      ) {
        return sum + Math.floor(block.text.length / 4)
      }
      return sum + 64
    }, 0)
  }
  return Math.floor(JSON.stringify(value ?? ``).length / 4)
}

export function sliceChars(value: string, from: number, to: number): string {
  return value.slice(from, to)
}

/**
 * Single shared token-count formatter: `Intl.NumberFormat` with
 * `notation: 'compact'` gives "1.2k", "12k", "1.2m" — locale-aware
 * and bounded in width. Lowercased suffix to match muted meta rows.
 * Used by the /goal command replies, the goal banner, and the
 * per-response token meta row so the same count never renders two
 * different ways in one UI.
 */
const compactTokenFormatter = new Intl.NumberFormat(undefined, {
  notation: `compact`,
  maximumFractionDigits: 1,
})

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  return compactTokenFormatter.format(n).toLowerCase()
}
