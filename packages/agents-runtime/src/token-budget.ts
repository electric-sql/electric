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
