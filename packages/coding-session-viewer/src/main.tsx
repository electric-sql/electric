import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

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
if (!root) throw new Error(`missing #root`)

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
