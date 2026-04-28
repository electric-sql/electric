import Anthropic from '@anthropic-ai/sdk'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'

const BRAVE_API_URL = `https://api.search.brave.com/res/v1/web/search`
const SEARCH_FALLBACK_MODEL = `claude-haiku-4-5-20251001`

interface SearchResult {
  content: Array<{ type: `text`; text: string }>
  details: { resultCount: number }
}

async function searchViaBrave(
  query: string,
  apiKey: string
): Promise<SearchResult> {
  const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=5`
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': apiKey },
  })

  if (!res.ok) {
    throw new Error(`Brave search failed: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as {
    web?: {
      results?: Array<{
        title: string
        url: string
        description: string
      }>
    }
  }
  const results = data.web?.results ?? []

  if (results.length === 0) {
    return {
      content: [
        { type: `text` as const, text: `No results found for "${query}"` },
      ],
      details: { resultCount: 0 },
    }
  }

  const formatted = results
    .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
    .join(`\n\n`)

  return {
    content: [{ type: `text` as const, text: formatted }],
    details: { resultCount: results.length },
  }
}

async function searchViaAnthropic(query: string): Promise<SearchResult> {
  const client = new Anthropic()
  const res = await client.messages.create({
    model: SEARCH_FALLBACK_MODEL,
    max_tokens: 1024,
    tools: [{ type: `web_search_20250305`, name: `web_search` }],
    messages: [{ role: `user`, content: query }],
  })

  const textBlocks = res.content.filter(
    (b): b is Anthropic.TextBlock => b.type === `text`
  )
  const text = textBlocks.map((b) => b.text).join(`\n`)

  if (!text.trim()) {
    return {
      content: [
        { type: `text` as const, text: `No results found for "${query}"` },
      ],
      details: { resultCount: 0 },
    }
  }

  return {
    content: [{ type: `text` as const, text }],
    details: { resultCount: textBlocks.length },
  }
}

export const braveSearchTool: AgentTool = {
  name: `web_search`,
  label: `Web Search`,
  description: `Search the web for current information. Returns titles, URLs, and snippets from top results.`,
  parameters: Type.Object({
    query: Type.String({ description: `The search query` }),
  }),
  execute: async (_toolCallId, params) => {
    const { query } = params as { query: string }
    const braveKey = process.env.BRAVE_SEARCH_API_KEY

    try {
      if (braveKey) {
        return await searchViaBrave(query, braveKey)
      }
      return await searchViaAnthropic(query)
    } catch (err) {
      return {
        content: [
          {
            type: `text` as const,
            text: `Search failed: ${err instanceof Error ? err.message : `Unknown error`}`,
          },
        ],
        details: { resultCount: 0 },
      }
    }
  },
}
