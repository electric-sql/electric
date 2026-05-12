import { BrowserWindow, app } from 'electron'
import path from 'node:path'

/**
 * Per-server OAuth flow controller.
 *
 * Opens the SDK-issued authorize URL inside a sandboxed `BrowserWindow`,
 * watches `webContents` navigation events for the redirect back to the
 * runtime's `/oauth/callback/<server>` URI, and resolves with the
 * `code` + `state` query params extracted from that URL.
 *
 * The redirect itself is *cancelled* — we never actually navigate to
 * the loopback URI, so the runtime doesn't need an HTTP listener for
 * the callback. The caller is responsible for handing the code+state
 * to the registry via `registry.finishAuth(...)`.
 *
 * One window per (server) at a time; subsequent calls for the same
 * server replace the first.
 */

interface OAuthCallbackResult {
  server: string
  code: string
  state?: string
}

const openWindows = new Map<string, BrowserWindow>()

/**
 * Open an OAuth authorize window. Returns a Promise that resolves with
 * the captured code+state, or rejects if the user closes the window
 * without completing the flow.
 */
export function openAuthorizeWindow(opts: {
  server: string
  authorizeUrl: string
  /** URL prefix that signals "Honeycomb is redirecting back to us with the code". */
  redirectUriPrefix: string
  /** Optional parent window to position the auth window over. */
  parent?: BrowserWindow | undefined
}): Promise<OAuthCallbackResult> {
  // Replace any pre-existing window for this server (re-auth click while
  // a previous flow is open) — close it before we open the new one.
  const existing = openWindows.get(opts.server)
  if (existing && !existing.isDestroyed()) {
    existing.close()
  }

  return new Promise<OAuthCallbackResult>((resolve, reject) => {
    let resolved = false
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      title: `Authorize ${opts.server}`,
      parent: opts.parent,
      modal: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // No preload — this window is just hosting the auth provider's
        // login form. We don't expose any APIs to it.
      },
    })

    openWindows.set(opts.server, win)

    const settle = (kind: `done` | `cancel`, payload?: OAuthCallbackResult) => {
      if (resolved) return
      resolved = true
      openWindows.delete(opts.server)
      // Schedule the close after current event tick — closing inside a
      // navigation listener occasionally races with Electron's own
      // teardown and prints "Object has been destroyed" stacks.
      setImmediate(() => {
        if (!win.isDestroyed()) win.close()
      })
      if (kind === `done` && payload) resolve(payload)
      else reject(new Error(`OAuth flow cancelled for ${opts.server}`))
    }

    const tryIntercept = (rawUrl: string): boolean => {
      if (!rawUrl.startsWith(opts.redirectUriPrefix)) return false
      try {
        const u = new URL(rawUrl)
        const code = u.searchParams.get(`code`)
        const state = u.searchParams.get(`state`) ?? undefined
        if (!code) {
          settle(`cancel`)
          return true
        }
        settle(`done`, { server: opts.server, code, state })
        return true
      } catch {
        return false
      }
    }

    // `will-redirect` fires for HTTP 30x responses — the typical OAuth
    // success path goes Honeycomb → 302 → loopback URI; this catches it
    // before the renderer actually tries to fetch the loopback URL
    // (which would 404 since we don't have an HTTP listener there).
    win.webContents.on(`will-redirect`, (event, url) => {
      if (tryIntercept(url)) {
        event.preventDefault()
      }
    })
    // `will-navigate` covers the case where the auth server returns a
    // page that JS-navigates to the redirect URI (rare but possible).
    win.webContents.on(`will-navigate`, (event, url) => {
      if (tryIntercept(url)) {
        event.preventDefault()
      }
    })

    win.on(`closed`, () => {
      settle(`cancel`)
    })

    void win.loadURL(opts.authorizeUrl)
  })
}

// Hint for environments that bundle this file but don't actually run
// Electron — keeps `app` from being tree-shaken if the import is the
// only reference. (Used by the dev-mode preflight in `main.ts`.)
void app
void path
