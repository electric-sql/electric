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

import '@fontsource-variable/figtree'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui'
import './markdown.css'
import { App } from './App'

// ngrok's free tier intercepts browser requests with an HTML warning page
// (status 200, no CORS header) — every fetch to an ngrok host fails CORS
// as a result. Setting `ngrok-skip-browser-warning` on every outbound
// request makes ngrok pass through to the upstream. No effect on requests
// to non-ngrok hosts. Covers the durable-streams client's internal fetches
// too, since it calls through the global fetch.
const originalFetch = window.fetch.bind(window)
window.fetch = (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const headers = new Headers(init?.headers ?? {})
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
