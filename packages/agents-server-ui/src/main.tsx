import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@radix-ui/themes/styles.css'
import './styles.css'
import { App } from './App'

// `crypto.randomUUID` is only exposed in secure contexts (HTTPS or
// localhost). When the UI is served over plain HTTP from a LAN IP
// (e.g. http://192.168.1.80:4437) the API is undefined and any code
// that calls it (nanoid v5+, runtime helpers, durable-streams, etc.)
// throws TypeError. Polyfill it via `crypto.getRandomValues`, which
// IS available in non-secure contexts.
if (typeof crypto !== `undefined` && typeof crypto.randomUUID !== `function`) {
  ;(crypto as Crypto & { randomUUID: () => string }).randomUUID = () => {
    const b = new Uint8Array(16)
    crypto.getRandomValues(b)
    // Per RFC 4122 §4.4: set version (4) and variant (10).
    b[6] = (b[6]! & 0x0f) | 0x40
    b[8] = (b[8]! & 0x3f) | 0x80
    const h: Array<string> = []
    for (let i = 0; i < 16; i++) h.push(b[i]!.toString(16).padStart(2, `0`))
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}` as `${string}-${string}-${string}-${string}-${string}`
  }
}

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
