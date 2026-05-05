/**
 * Wire format for the React-Native ⇄ embed message bridge.
 *
 * Both sides agree on a tiny JSON protocol passed over the WebView
 * postMessage channel. Keep the surface small — anything richer should
 * be added explicitly here, never invented at the call site.
 *
 *   native → embed   `set-view` | `set-entity` | `set-theme`
 *   embed  → native  `ready`    | `navigate`   | `error`
 *
 * The native side mirrors these types in
 * `packages/agents-mobile/src/webview/bridge.ts`. When you change the
 * shape here, change it there too.
 */

export type EmbedView = `chat` | `state-explorer`
export type EmbedTheme = `light` | `dark`

export type NativeToEmbedMessage =
  | { type: `set-view`; view: EmbedView }
  | { type: `set-entity`; entityUrl: string }
  | { type: `set-theme`; theme: EmbedTheme }

export type EmbedToNativeMessage =
  | { type: `ready` }
  | { type: `navigate`; pathname: string }
  | { type: `error`; message: string }

/**
 * Subscribe to messages coming from the React Native host.
 *
 * iOS WKWebView dispatches `webView.postMessage(string)` to BOTH
 * `window` and `document`, while Android dispatches to `window` only.
 * Listening on both ensures we never miss a message regardless of
 * platform.
 *
 * Returns an unsubscribe function suitable for a `useEffect` cleanup.
 */
export function subscribeNativeToEmbed(
  handler: (message: NativeToEmbedMessage) => void
): () => void {
  function onMessage(event: MessageEvent) {
    const raw = event.data
    if (typeof raw !== `string`) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (
      parsed &&
      typeof parsed === `object` &&
      `type` in parsed &&
      typeof (parsed as { type: unknown }).type === `string`
    ) {
      handler(parsed as NativeToEmbedMessage)
    }
  }
  window.addEventListener(`message`, onMessage)
  document.addEventListener(`message`, onMessage as EventListener)
  return () => {
    window.removeEventListener(`message`, onMessage)
    document.removeEventListener(`message`, onMessage as EventListener)
  }
}

/**
 * Send a message to the native host. Safe to call before the host
 * binding is wired up — the message is silently dropped if the embed
 * is loaded standalone in a browser tab (dev workflow).
 */
export function postEmbedToNative(message: EmbedToNativeMessage): void {
  const bridge = window.ReactNativeWebView
  if (!bridge) return
  bridge.postMessage(JSON.stringify(message))
}

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (data: string) => void
    }
  }
}
