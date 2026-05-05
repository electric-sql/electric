import { useEffect, useMemo, useState } from 'react'
import { Asset } from 'expo-asset'
import type { ColorScheme } from '../lib/theme'
import type { EmbedView } from './bridge'

export type EmbedViewId = EmbedView

// Static `require` so Metro registers the asset at bundle time. The
// `assets/embed.html` file is committed in the repo as a small
// placeholder so a fresh checkout resolves; running
// `pnpm -F @electric-ax/agents-server-ui build:mobile-embed`
// overwrites it with the real bundled embed.
const EMBED_ASSET: number = require(`../../assets/embed.html`)

export type EmbedConfig = {
  serverUrl: string
  entityUrl: string
  view: EmbedViewId
  theme: ColorScheme
}

export type EmbedSource = {
  /** WebView `source.uri` once the asset has been resolved to a local file. */
  uri: string | null
  /** Set as `injectedJavaScriptBeforeContentLoaded` on the WebView. */
  injectedJavaScriptBeforeContentLoaded: string
  /** True until expo-asset has resolved the local URI. */
  loading: boolean
  /** Asset resolution error, if any. */
  error: Error | null
}

/**
 * Resolves the WebView source for a session.
 *
 * The embed HTML lives as a static asset (so Metro doesn't have to
 * inline 13 MB of JavaScript into the JS bundle). expo-asset
 * downloads / resolves the asset once on first use and exposes a
 * `file://` URI we can hand to `WebView.source.uri`.
 *
 * The `EmbedConfig` is delivered to the embed via
 * `injectedJavaScriptBeforeContentLoaded`, which runs before any of
 * the embed's own scripts so it can pick up `serverUrl/entityUrl/
 * view/theme` synchronously on first paint. After mount, the embed
 * announces `{ type: 'ready' }` and the host switches to live
 * `set-*` messages so the heavy bundle never re-parses on routine
 * navigation.
 */
export function useEmbedSource(config: EmbedConfig): EmbedSource {
  const [uri, setUri] = useState<string | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    const asset = Asset.fromModule(EMBED_ASSET)
    if (asset.localUri) {
      setUri(asset.localUri)
      return
    }
    asset
      .downloadAsync()
      .then((resolved) => {
        if (cancelled) return
        setUri(resolved.localUri ?? resolved.uri)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // We deliberately freeze the injection script after the first call.
  // The embed picks the initial config up synchronously on first
  // paint; subsequent runtime updates flow through `set-*` postMessages
  // so the asset (= bundle) never has to re-parse. `config` is read
  // only on first render — the deps array is intentionally empty.
  const initialConfigRef = useMemo(() => config, [])
  const injectedJavaScriptBeforeContentLoaded = useMemo(
    () => buildConfigInjection(initialConfigRef),
    [initialConfigRef]
  )

  return {
    uri,
    injectedJavaScriptBeforeContentLoaded,
    loading: uri === null && error === null,
    error,
  }
}

function buildConfigInjection(config: EmbedConfig): string {
  const payload = JSON.stringify(config)
  // Trailing `true;` is required by react-native-webview iOS so the
  // injected script returns a JSON-serialisable value.
  return `(function(){try{window.__MOBILE_EMBED__=${payload};}catch(_){}})();true;`
}
