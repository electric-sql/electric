import { createRequire } from 'node:module'
import { Type } from '@sinclair/typebox'
import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
import TurndownService from 'turndown'
import { completeWithLowCostModel } from '../model-runner'
import { SandboxError } from '../sandbox/types'
import type { Sandbox } from '../sandbox/types'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { LowCostModelCatalog, LowCostModelConfig } from '../model-runner'

const MAX_RAW_CHARS = 100_000
const require = createRequire(import.meta.url)

const { gfm } = require(`turndown-plugin-gfm`) as {
  gfm: (service: TurndownService) => void
}

type ExtractWithLLM = (text: string, prompt: string) => Promise<string>

function htmlToMarkdown(html: string, url: string): string {
  const virtualConsole = new VirtualConsole()
  const dom = new JSDOM(html, { url, virtualConsole })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()

  const turndown = new TurndownService({ headingStyle: `atx` })
  turndown.use(gfm)
  return turndown.turndown(article?.content ?? html)
}

function createPiRunnerExtractor(opts: {
  catalog?: LowCostModelCatalog
  modelConfig?: LowCostModelConfig
  log?: (message: string) => void
  logPrefix?: string
}): ExtractWithLLM {
  return (text, prompt) =>
    completeWithLowCostModel({
      catalog: opts.catalog,
      modelConfig: opts.modelConfig,
      log: opts.log,
      logPrefix: opts.logPrefix,
      purpose: `URL extraction`,
      systemPrompt: `Extract the requested information from the page content. Return only the extracted content, without commentary about the extraction process.`,
      prompt: `${prompt}\n\n<page_content>\n${text}\n</page_content>`,
      maxTokens: 2048,
    })
}

export function createFetchUrlTool(
  sandbox: Sandbox,
  opts: {
    extractWithLLM?: ExtractWithLLM
    catalog?: LowCostModelCatalog
    modelConfig?: LowCostModelConfig
    log?: (message: string) => void
    logPrefix?: string
  } = {}
): AgentTool {
  const extractWithLLM = opts.extractWithLLM ?? createPiRunnerExtractor(opts)
  return {
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
        const res = await sandbox.fetch(url, {
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

        const extracted = await extractWithLLM(
          markdown.slice(0, MAX_RAW_CHARS),
          prompt
        )

        return {
          content: [{ type: `text` as const, text: extracted }],
          details: { charCount: extracted.length, usedLLM: true },
        }
      } catch (err) {
        // Surface a network-policy denial (allowlist miss / SSRF guard) as a
        // distinct, actionable signal — mirrors the FS tools' policy handling —
        // so the model knows the URL was blocked rather than transiently failing.
        if (err instanceof SandboxError && err.kind === `policy`) {
          return {
            content: [
              {
                type: `text` as const,
                text: `Error: URL "${url}" was blocked by the sandbox network policy (it targets a disallowed or private/link-local address).`,
              },
            ],
            details: { charCount: 0, usedLLM: false },
          }
        }
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
}
