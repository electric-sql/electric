const OPEN = `<!-- agent-managed:summary -->`
const CLOSE = `<!-- /agent-managed:summary -->`

export function renderManagedSummary(
  description: string,
  summary: string
): string {
  const start = description.indexOf(OPEN)
  const end = description.indexOf(CLOSE)
  if (start === -1 || end === -1 || end < start) {
    const trimmed = description.replace(/\s+$/, ``)
    return `${trimmed}\n\n${OPEN}\n${summary}\n${CLOSE}\n`
  }
  const before = description.slice(0, start + OPEN.length)
  const after = description.slice(end)
  return `${before}\n${summary}\n${after}`
}
