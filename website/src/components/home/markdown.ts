export function toPlainText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, ` `)
    .replace(/<[^>]+>/g, ``)
    .replace(/&nbsp;/g, ` `)
    .replace(/&mdash;/g, ` - `)
    .replace(/&middot;/g, ` · `)
    .replace(/&amp;/g, `&`)
    .replace(/\s+/g, ` `)
    .trim()
}
