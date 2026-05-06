import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Registry } from '../registry'

export async function handleOAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
  registry: Registry,
  serverName: string
): Promise<void> {
  const u = new URL(req.url ?? `/`, `http://x`)
  const code = u.searchParams.get(`code`)
  const state = u.searchParams.get(`state`) ?? undefined
  const error = u.searchParams.get(`error`)

  if (error) {
    res.statusCode = 400
    res.setHeader(`Content-Type`, `text/html`)
    res.end(renderPage(`Authorization failed: ${error}`, `error`))
    return
  }
  if (!code) {
    res.statusCode = 400
    res.setHeader(`Content-Type`, `text/html`)
    res.end(renderPage(`Missing authorization code.`, `error`))
    return
  }

  try {
    await (
      registry as Registry & {
        finishAuth: (s: string, c: string, st?: string) => Promise<unknown>
      }
    ).finishAuth(serverName, code, state)
    res.statusCode = 200
    res.setHeader(`Content-Type`, `text/html`)
    res.end(
      renderPage(`Authorized "${serverName}". You can close this tab.`, `ok`)
    )
  } catch (err) {
    res.statusCode = 500
    res.setHeader(`Content-Type`, `text/html`)
    res.end(
      renderPage(`Token exchange failed: ${(err as Error).message}`, `error`)
    )
  }
}

function renderPage(body: string, kind: `ok` | `error`): string {
  const color = kind === `ok` ? `#0a7` : `#a00`
  return `<!doctype html><meta charset=utf-8><title>MCP OAuth</title>
<style>body{font:14px system-ui;padding:2rem;color:${color}}</style><p>${body}</p>`
}
