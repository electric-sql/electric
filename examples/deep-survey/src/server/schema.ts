import { z } from 'zod'

export const wikiEntrySchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  author: z.string().min(1),
  improved: z.boolean().default(false),
})

export const xrefSchema = z.object({
  key: z.string().min(1),
  a: z.string().min(1),
  b: z.string().min(1),
})

export type WikiEntry = z.infer<typeof wikiEntrySchema>
export type Xref = z.infer<typeof xrefSchema>

export const swarmSharedSchema = {
  wiki: {
    schema: wikiEntrySchema,
    type: `shared:wiki_entry`,
    primaryKey: `key`,
  },
  xrefs: {
    schema: xrefSchema,
    type: `shared:xref`,
    primaryKey: `key`,
  },
} as const
