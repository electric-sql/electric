export function toMarkdownUrl(relativePath?: string) {
  const normalized = String(relativePath ?? ``)
    .replace(/^\//, ``)
    .replace(/\.html$/, ``)
    .replace(/\.md$/, ``)

  if (!normalized || normalized === `index`) {
    return `/index.md`
  }

  if (normalized.startsWith(`docs/`) && normalized.endsWith(`/index`)) {
    return `/${normalized.slice(0, -`/index`.length)}.md`
  }

  return `/${normalized}.md`
}
