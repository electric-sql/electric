import { z } from 'zod'

import {
  sourceSchema,
  wikiPageSchema,
  type SourceRow,
  type WikiPageRow,
} from './wiki-state'
import { createWikiPageId } from './wiki-state-ids'

const overrideSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  slug: z.string().trim().min(1).max(160).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
})

export type BuildWikiPageFromSourceOptions = z.input<typeof overrideSchema> & {
  now?: () => Date
  pageSeed?: string
}

export function slugifyWikiPageTitle(
  title: string,
  fallbackSeed: string
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, `-`)
    .replace(/-+/g, `-`)
    .replace(/^-+|-+$/g, ``)
    .slice(0, 120)
    .replace(/-+$/g, ``)
  if (slug.length > 0 && /^[a-z0-9]/.test(slug)) return slug
  return `source-${fallbackSeed
    .replace(/^source_/, ``)
    .replace(/[^a-z0-9-]/g, `-`)
    .slice(0, 113)}`
}

export function buildWikiPageFromSubmittedSource(
  sourceInput: SourceRow,
  options: BuildWikiPageFromSourceOptions = {}
): WikiPageRow {
  const source = sourceSchema.parse(sourceInput)
  if (source.status !== `submitted`) {
    throw new Error(`Source must be submitted before proposing a page`)
  }
  const parsed = overrideSchema.parse(options)
  const now = (options.now?.() ?? new Date()).toISOString()
  const title = parsed.title ?? source.title
  const slug = slugifyWikiPageTitle(parsed.slug ?? title, source.id)
  const body = parsed.body ?? defaultBody(source, title)
  return wikiPageSchema.parse({
    id: createWikiPageId(
      options.pageSeed ?? `${source.wiki_space_id}-${source.id}`
    ),
    wiki_space_id: source.wiki_space_id,
    slug,
    title,
    status: `proposed`,
    summary: `${source.kind === `url` ? `URL` : `Text`} source proposed for manual review: ${title}`,
    body,
    source_ids: [source.id],
    created_at: now,
    updated_at: now,
    created_by_run_id: null,
  })
}

function defaultBody(source: SourceRow, title: string): string {
  if (source.kind === `url`) {
    return [
      `# ${title}`,
      ``,
      `Manual page proposal from submitted URL metadata.`,
      ``,
      `Source URL: ${source.url}`,
      `Source title: ${source.title}`,
      ``,
      `No URL fetch, scraping, digesting, or AI generation has occurred.`,
    ].join(`\n`)
  }
  return [
    `# ${title}`,
    ``,
    `Manual page proposal from submitted text preview.`,
    ``,
    source.text_preview ?? ``,
    ``,
    `Stored preview only; no digesting or AI generation has occurred.`,
  ].join(`\n`)
}
