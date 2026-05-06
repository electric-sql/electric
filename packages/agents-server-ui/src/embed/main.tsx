import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../ui'
import '../markdown.css'
import '../lib/workspace/registerViews'
import { installMobileCryptoPolyfill } from './mobileDomRuntime'
import { EmbedApp } from './EmbedApp'

/**
 * Mobile embed entrypoint.
 *
 * Mounts a stripped-down version of the agents UI inside a React Native
 * `WebView`. The native shell sets `window.__MOBILE_EMBED__` BEFORE this
 * script runs (via `injectedJavaScriptBeforeContentLoaded`) so the embed
 * can pick up its server URL, target entity, view id and theme on first
 * paint without a round-trip.
 *
 * The embed shares all of `agents-server-ui`'s components, hooks and
 * design tokens — only the chrome (sidebar, tab bar, settings, …) is
 * dropped because those are owned by the native shell.
 */

installMobileCryptoPolyfill()

const rootEl = document.getElementById(`root`)
if (!rootEl) {
  throw new Error(`Missing #root container`)
}

createRoot(rootEl).render(
  <StrictMode>
    <EmbedApp />
  </StrictMode>
)
