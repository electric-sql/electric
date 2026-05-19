// React Scan — dev-only. Dynamically imported (and awaited) BEFORE
// the React imports below so it can monkey-patch React's reconciler
// before any component mounts; gated on `import.meta.env.DEV` so the
// production bundle never sees the dependency. Toggle the on-screen
// toolbar off via the floating widget if it gets in the way; the
// instrumentation keeps running so the in-DOM render highlights
// still work.
if (import.meta.env.DEV) {
  // eslint-disable-next-line quotes -- dynamic `import()` requires a plain string literal
  const { scan } = await import('react-scan')
  scan({ enabled: true })
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui'
import './markdown.css'
// Side-effect import: registers all built-in views (chat, state explorer,
// …) into the view registry before the app mounts. Adding a new view is
// a single new `registerView({…})` call inside this module.
import './lib/workspace/registerViews'
import { App } from './App'

// ngrok's free tier intercepts browser requests with an HTML warning page
// (status 200, no CORS header) — every fetch to an ngrok host fails CORS
// as a result. Set `ngrok-skip-browser-warning` only for ngrok hosts:
// adding a custom header to local sends forces CORS preflights.
function isNgrokHost(input: RequestInfo | URL): boolean {
  try {
    const url =
      input instanceof Request
        ? new URL(input.url, window.location.href)
        : new URL(input, window.location.href)
    return (
      url.hostname === `ngrok-free.app` ||
      url.hostname.endsWith(`.ngrok-free.app`) ||
      url.hostname === `ngrok.app` ||
      url.hostname.endsWith(`.ngrok.app`) ||
      url.hostname === `ngrok.dev` ||
      url.hostname.endsWith(`.ngrok.dev`) ||
      url.hostname === `ngrok.io` ||
      url.hostname.endsWith(`.ngrok.io`) ||
      url.hostname === `ngrok-free.dev` ||
      url.hostname.endsWith(`.ngrok-free.dev`)
    )
  } catch {
    return false
  }
}

const originalFetch = window.fetch.bind(window)
window.fetch = (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  if (!isNgrokHost(input)) return originalFetch(input, init)
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  )
  if (!headers.has(`ngrok-skip-browser-warning`)) {
    headers.set(`ngrok-skip-browser-warning`, `true`)
  }
  return originalFetch(input, { ...init, headers })
}

const root = document.getElementById(`root`)

if (!root) {
  throw new Error(`Missing #root container`)
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
