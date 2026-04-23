import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'

const BRAVE_API_URL = `https://api.search.brave.com/res/v1/web/search`

export const braveSearchTool: AgentTool = {
  name: `web_search`,
  label: `Web Search`,
  description: `Search the web for current information using Brave Search. Returns titles, URLs, and snippets from top results.`,
  parameters: Type.Object({
    query: Type.String({ description: `The search query` }),
  }),
  execute: async (_toolCallId, params) => {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY
    if (!apiKey) {
      return {
        content: [
          {
            type: `text` as const,
            text: `Search failed: BRAVE_SEARCH_API_KEY not set`,
          },
        ],
        details: { resultCount: 0 },
      }
    }

    const { query } = params as { query: string }
    try {
      const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=5`
      const res = await fetch(url, {
        headers: { 'X-Subscription-Token': apiKey },
      })

      if (!res.ok) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Search failed: ${res.status} ${res.statusText}`,
            },
          ],
          details: { resultCount: 0 },
        }
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
            {
              type: `text` as const,
              text: `No results found for "${query}"`,
            },
          ],
          details: { resultCount: 0 },
        }
      }

      const formatted = results
        .map(
          (r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`
        )
        .join(`\n\n`)

      return {
        content: [{ type: `text` as const, text: formatted }],
        details: { resultCount: results.length },
      }
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
