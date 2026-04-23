import { createRequire } from 'node:module'
import { Type } from '@sinclair/typebox'
import Anthropic from '@anthropic-ai/sdk'
import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
import TurndownService from 'turndown'
import type { AgentTool } from '@mariozechner/pi-agent-core'

const MAX_RAW_CHARS = 100_000
const require = createRequire(import.meta.url)

const { gfm } = require(`turndown-plugin-gfm`) as {
  gfm: (service: TurndownService) => void
}

function htmlToMarkdown(html: string, url: string): string {
  const virtualConsole = new VirtualConsole()
  const dom = new JSDOM(html, { url, virtualConsole })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()

  const turndown = new TurndownService({ headingStyle: `atx` })
  turndown.use(gfm)
  return turndown.turndown(article?.content ?? html)
}

let anthropic: Anthropic | null = null
function getClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic()
  }
  return anthropic
}

async function extractWithLLM(text: string, prompt: string): Promise<string> {
  const client = getClient()
  const res = await client.messages.create({
    model: `claude-haiku-4-5-20251001`,
    max_tokens: 2048,
    messages: [
      {
        role: `user`,
        content: `${prompt}\n\n<page_content>\n${text.slice(0, MAX_RAW_CHARS)}\n</page_content>`,
      },
    ],
  })
  const block = res.content[0]
  return block?.type === `text` ? block.text : ``
}

export const fetchUrlTool: AgentTool = {
  name: `fetch_url`,
  label: `Fetch URL`,
  description: `Fetch a web page and extract its key content using AI. Provide a prompt describing what information you want from the page. Returns a focused extraction rather than raw HTML.`,
  parameters: Type.Object({
    url: Type.String({ description: `The URL to fetch` }),
    prompt: Type.String({
      description: `What to extract from the page, e.g. 'Extract the main article content' or 'Find the pricing information'`,
    }),
  }),
  execute: async (_toolCallId, params) => {
    const { url, prompt } = params as { url: string; prompt: string }
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': `Mozilla/5.0 (compatible; DurableStreamsAgent/1.0)`,
          Accept: `text/html,application/xhtml+xml,text/plain,*/*`,
        },
        redirect: `follow`,
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Failed to fetch: ${res.status} ${res.statusText}`,
            },
          ],
          details: { charCount: 0, usedLLM: false },
        }
      }

      const contentType = res.headers.get(`content-type`) ?? ``
      const raw = await res.text()
      const markdown = contentType.includes(`text/html`)
        ? htmlToMarkdown(raw, url)
        : raw

      const extracted = await extractWithLLM(markdown, prompt)

      return {
        content: [{ type: `text` as const, text: extracted }],
        details: { charCount: extracted.length, usedLLM: true },
      }
    } catch (err) {
      return {
        content: [
          {
            type: `text` as const,
            text: `Error fetching URL: ${err instanceof Error ? err.message : `Unknown error`}`,
          },
        ],
        details: { charCount: 0, usedLLM: false },
      }
    }
  },
}
