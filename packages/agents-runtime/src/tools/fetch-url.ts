import { lookup } from 'node:dns/promises'
import { createRequire } from 'node:module'
import { isIP } from 'node:net'
import { Type } from '@sinclair/typebox'
import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
import TurndownService from 'turndown'
import { completeWithLowCostModel } from '../model-runner'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { LowCostModelCatalog, LowCostModelConfig } from '../model-runner'

const MAX_RAW_CHARS = 100_000
const require = createRequire(import.meta.url)

// Known gap: DNS rebinding — a second resolution between this check and
// the socket connect can return a different IP. Fixing this needs a
// custom undici dispatcher that pins to the resolved address.
function isPrivateIpv4(addr: string): boolean {
  const parts = addr.split(`.`).map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) {
    return false
  }
  const [a, b] = parts as [number, number, number, number]
  if (a === 0) return true
  if (a === 127) return true
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return false
}

function isPrivateIpv6(addr: string): boolean {
  const lower = addr.toLowerCase()
  if (lower === `::1` || lower === `::`) return true
  if (lower.startsWith(`::ffff:`)) {
    const v4 = lower.slice(`::ffff:`.length)
    if (isIP(v4) === 4) return isPrivateIpv4(v4)
  }
  // fe80::/10 link-local
  if (lower.startsWith(`fe8`) || lower.startsWith(`fe9`)) return true
  if (lower.startsWith(`fea`) || lower.startsWith(`feb`)) return true
  // fc00::/7 unique-local
  if (lower.startsWith(`fc`) || lower.startsWith(`fd`)) return true
  return false
}

function isPrivateAddress(addr: string): boolean {
  const family = isIP(addr)
  if (family === 4) return isPrivateIpv4(addr)
  if (family === 6) return isPrivateIpv6(addr)
  return false
}

async function assertUrlAllowed(
  rawUrl: string,
  allowedHosts: ReadonlySet<string>
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: `URL is not parseable` }
  }
  // URL form wraps IPv6 literals in brackets.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, ``)
  if (allowedHosts.has(hostname.toLowerCase())) return { ok: true }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      return {
        ok: false,
        reason: `URL host ${hostname} is in a private/loopback IP range`,
      }
    }
    return { ok: true }
  }
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(hostname, { all: true })
  } catch (err) {
    return {
      ok: false,
      reason: `Failed to resolve host ${hostname}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      return {
        ok: false,
        reason: `Host ${hostname} resolves to private/loopback address ${address}`,
      }
    }
  }
  return { ok: true }
}

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
  opts: {
    extractWithLLM?: ExtractWithLLM
    catalog?: LowCostModelCatalog
    modelConfig?: LowCostModelConfig
    log?: (message: string) => void
    logPrefix?: string
    /** Hostnames exempted from the private-IP guard (case-insensitive literal match, no DNS). */
    allowedHosts?: ReadonlyArray<string>
  } = {}
): AgentTool {
  const extractWithLLM = opts.extractWithLLM ?? createPiRunnerExtractor(opts)
  const allowedHosts = new Set(
    (opts.allowedHosts ?? []).map((h) => h.toLowerCase())
  )
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
        const guard = await assertUrlAllowed(url, allowedHosts)
        if (!guard.ok) {
          return {
            content: [
              {
                type: `text` as const,
                text: `Error fetching URL: ${guard.reason}`,
              },
            ],
            details: { charCount: 0, usedLLM: false },
          }
        }
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

        const extracted = await extractWithLLM(
          markdown.slice(0, MAX_RAW_CHARS),
          prompt
        )

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
}

export const fetchUrlTool: AgentTool = createFetchUrlTool()
