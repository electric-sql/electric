export function extractSearchableText(obj: Record<string, unknown>): string {
  const texts: string[] = []

  function traverse(value: unknown): void {
    if (typeof value === 'string') {
      const trimmed = value.trim()

      if (trimmed.length < 250) {
        texts.push(trimmed)
      }
    } else if (Array.isArray(value)) {
      value.forEach(traverse)
    } else if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(traverse)
    }
  }

  traverse(obj)

  return [...new Set(texts)].join(' ')
}
