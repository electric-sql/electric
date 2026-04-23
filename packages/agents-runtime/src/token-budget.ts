export function approxTokens(value: string): number {
  return Math.floor(value.length / 4)
}

export function sliceChars(value: string, from: number, to: number): string {
  return value.slice(from, to)
}
