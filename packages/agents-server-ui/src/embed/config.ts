/**
 * Mobile embed config injected by the React Native `WebView` host before
 * the bundled embed script runs.
 *
 * The native shell uses `injectedJavaScriptBeforeContentLoaded` to set
 * `window.__MOBILE_EMBED__`. Falling back to URL hash parameters keeps
 * the embed openable in a normal browser for development.
 */

export type MobileEmbedView = `chat` | `state-explorer`
export type MobileEmbedTheme = `light` | `dark`

export type MobileEmbedConfig = {
  serverUrl: string
  entityUrl: string
  view: MobileEmbedView
  theme: MobileEmbedTheme
}

declare global {
  interface Window {
    __MOBILE_EMBED__?: MobileEmbedConfig
  }
}

export function readEmbedConfig(): MobileEmbedConfig {
  const fromGlobal = window.__MOBILE_EMBED__
  if (fromGlobal) return normalize(fromGlobal)

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ``))
  return normalize({
    serverUrl: params.get(`serverUrl`) ?? window.location.origin,
    entityUrl: params.get(`entityUrl`) ?? ``,
    view: (params.get(`view`) as MobileEmbedView | null) ?? `chat`,
    theme: (params.get(`theme`) as MobileEmbedTheme | null) ?? `dark`,
  })
}

function normalize(input: Partial<MobileEmbedConfig>): MobileEmbedConfig {
  return {
    serverUrl: (input.serverUrl ?? ``).replace(/\/+$/, ``),
    entityUrl: input.entityUrl ?? ``,
    view: input.view === `state-explorer` ? `state-explorer` : `chat`,
    theme: input.theme === `light` ? `light` : `dark`,
  }
}
