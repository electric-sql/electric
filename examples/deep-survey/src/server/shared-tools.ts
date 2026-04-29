import { Type } from '@sinclair/typebox'
import type { AgentTool, SharedStateHandle } from '@electric-ax/agents-runtime'
import {
  swarmSharedSchema,
  wikiEntrySchema,
  xrefSchema,
  type WikiEntry,
  type Xref,
} from './schema.js'

export type SwarmSharedState = SharedStateHandle<typeof swarmSharedSchema>

const BRAVE_API_URL = `https://api.search.brave.com/res/v1/web/search`
const MAX_FETCH_CHARS = 20_000

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: `text` as const, text }],
    details,
  }
}

async function awaitPersisted(transaction: unknown): Promise<void> {
  const promise = (
    transaction as { isPersisted?: { promise?: Promise<unknown> } } | null
  )?.isPersisted?.promise
  if (promise) await promise
}

function formatEntries(entries: Array<WikiEntry>, xrefs: Array<Xref>): string {
  if (entries.length === 0) return `(empty)`

  const entryKeys = new Set(entries.map((entry) => entry.key))
  const relatedXrefs = xrefs.filter(
    (xref) => entryKeys.has(xref.a) || entryKeys.has(xref.b)
  )

  return [
    `Wiki entries (${entries.length}):`,
    ...entries.map(
      (entry) =>
        `- ${entry.key}: ${entry.title}\n  author: ${entry.author}\n  improved: ${entry.improved}\n  body: ${entry.body}`
    ),
    ``,
    `Cross-references (${relatedXrefs.length}):`,
    ...(relatedXrefs.length
      ? relatedXrefs.map((xref) => `- ${xref.key}: ${xref.a} <-> ${xref.b}`)
      : [`(none)`]),
  ].join(`\n`)
}

function makeXrefKey(a: string, b: string): string {
  return [a, b].sort((left, right) => left.localeCompare(right)).join(`--`)
}

function extractReadableText(raw: string, contentType: string): string {
  if (!contentType.includes(`html`)) {
    return raw.replace(/\s+/g, ` `).trim()
  }

  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ` `)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ` `)
    .replace(/<[^>]+>/g, ` `)
    .replace(/&nbsp;/g, ` `)
    .replace(/&amp;/g, `&`)
    .replace(/&lt;/g, `<`)
    .replace(/&gt;/g, `>`)
    .replace(/&quot;/g, `"`)
    .replace(/&#39;/g, `'`)
    .replace(/\s+/g, ` `)
    .trim()
}

export function createWebSearchTool(): AgentTool {
  return {
    name: `web_search`,
    label: `Web Search`,
    description: `Search the web for current information. Returns titles, URLs, and snippets.`,
    parameters: Type.Object({
      query: Type.String({ description: `The search query` }),
    }),
    execute: async (_toolCallId, params) => {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY
      if (!apiKey) {
        return textResult(`Search failed: BRAVE_SEARCH_API_KEY not set`, {
          resultCount: 0,
        })
      }

      const { query } = params as { query: string }
      const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=5`
      const res = await fetch(url, {
        headers: { 'X-Subscription-Token': apiKey },
      })
      if (!res.ok) {
        return textResult(`Search failed: ${res.status} ${res.statusText}`, {
          resultCount: 0,
        })
      }

      const data = (await res.json()) as {
        web?: {
          results?: Array<{ title: string; url: string; description: string }>
        }
      }
      const results = data.web?.results ?? []
      if (results.length === 0) {
        return textResult(`No results found for "${query}"`, {
          resultCount: 0,
        })
      }

      const formatted = results
        .map(
          (result, index) =>
            `${index + 1}. **${result.title}**\n   ${result.url}\n   ${result.description}`
        )
        .join(`\n\n`)
      return textResult(formatted, { resultCount: results.length })
    },
  }
}

export function createFetchUrlTool(): AgentTool {
  return {
    name: `fetch_url`,
    label: `Fetch URL`,
    description: `Fetch a URL and return readable page text. Use the optional prompt to say what facts to look for.`,
    parameters: Type.Object({
      url: Type.String({ description: `The URL to fetch` }),
      prompt: Type.Optional(
        Type.String({ description: `What information to focus on` })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { url, prompt } = params as { url: string; prompt?: string }
      const res = await fetch(url, {
        headers: {
          'User-Agent': `DeepSurveyAgent/0.1`,
          Accept: `text/html,application/xhtml+xml,text/plain,*/*`,
        },
        redirect: `follow`,
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        return textResult(`Fetch failed: ${res.status} ${res.statusText}`, {
          url,
          charCount: 0,
        })
      }

      const raw = await res.text()
      const text = extractReadableText(
        raw,
        res.headers.get(`content-type`) ?? ``
      )
      const clipped = text.slice(0, MAX_FETCH_CHARS)
      const heading = prompt ? `Focus: ${prompt}\n\n` : ``
      return textResult(`${heading}${clipped}`, {
        url,
        charCount: clipped.length,
        truncated: text.length > MAX_FETCH_CHARS,
      })
    },
  }
}

export function createWriteWikiTool(shared: SwarmSharedState): AgentTool {
  return {
    name: `write_wiki`,
    label: `Write Wiki`,
    description: `Write or replace one shared wiki entry. Use the worker entity id as the key for worker-authored entries.`,
    parameters: Type.Object({
      key: Type.String({ description: `Stable wiki entry key` }),
      title: Type.String({ description: `Short descriptive title` }),
      body: Type.String({ description: `Synthesized findings` }),
      author: Type.String({ description: `Author name for this entry` }),
      improved: Type.Optional(
        Type.Boolean({ description: `Whether this is an improved entry` })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const parsed = wikiEntrySchema.parse(params)
      const collection = shared.wiki
      const existing = collection.get(parsed.key)
      const transaction = existing
        ? collection.update(parsed.key, (draft) => {
            Object.assign(draft, parsed)
          })
        : collection.insert(parsed)
      await awaitPersisted(transaction)

      return textResult(`Wrote wiki entry "${parsed.key}": ${parsed.title}`, {
        key: parsed.key,
        created: !existing,
      })
    },
  }
}

export function createReadWikiTool(shared: SwarmSharedState): AgentTool {
  return {
    name: `read_wiki`,
    label: `Read Wiki`,
    description: `Read shared wiki entries and related cross-references. Optionally filter by a search query.`,
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description: `Text to search in key, title, author, or body`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { query } = params as { query?: string }
      const allEntries = shared.wiki.toArray
      const xrefs = shared.xrefs.toArray
      const entries = query
        ? allEntries.filter((entry) => {
            const needle = query.toLowerCase()
            return (
              entry.key.toLowerCase().includes(needle) ||
              entry.title.toLowerCase().includes(needle) ||
              entry.author.toLowerCase().includes(needle) ||
              entry.body.toLowerCase().includes(needle)
            )
          })
        : allEntries

      return textResult(formatEntries(entries, xrefs), {
        query: query ?? null,
        returnedEntries: entries.length,
        totalEntries: allEntries.length,
        totalXrefs: xrefs.length,
      })
    },
  }
}

export function createWriteXrefsTool(shared: SwarmSharedState): AgentTool {
  return {
    name: `write_xrefs`,
    label: `Write Cross-Reference`,
    description: `Write or replace one cross-reference edge between two wiki entry keys.`,
    parameters: Type.Object({
      key: Type.Optional(
        Type.String({
          description: `Stable edge key. If omitted, it is generated as the two entry keys in alphabetical order joined by "--".`,
        })
      ),
      a: Type.String({ description: `First wiki entry key` }),
      b: Type.String({ description: `Second wiki entry key` }),
    }),
    execute: async (_toolCallId, params) => {
      const raw = params as { key?: string; a: string; b: string }
      if (raw.a === raw.b) {
        return textResult(`Cannot cross-reference an entry to itself.`, {
          created: false,
        })
      }

      const parsed = xrefSchema.parse({
        key: raw.key?.trim() || makeXrefKey(raw.a, raw.b),
        a: raw.a,
        b: raw.b,
      })
      const collection = shared.xrefs
      const existing = collection.get(parsed.key)
      const transaction = existing
        ? collection.update(parsed.key, (draft) => {
            Object.assign(draft, parsed)
          })
        : collection.insert(parsed)
      await awaitPersisted(transaction)

      return textResult(
        `Wrote cross-reference "${parsed.key}": ${parsed.a} <-> ${parsed.b}`,
        {
          key: parsed.key,
          created: !existing,
        }
      )
    },
  }
}

export function createSharedWikiTools(
  shared: SwarmSharedState
): Array<AgentTool> {
  return [
    createWriteWikiTool(shared),
    createReadWikiTool(shared),
    createWriteXrefsTool(shared),
  ]
}
