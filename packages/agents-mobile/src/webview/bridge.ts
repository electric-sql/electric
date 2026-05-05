/**
 * Wire format for the React-Native ⇄ embed message bridge.
 *
 * Both sides agree on a tiny JSON protocol passed over the WebView
 * postMessage channel. This file is the native mirror of
 * `packages/agents-server-ui/src/embed/bridge.ts`. When you change
 * the shape there, change it here too — they intentionally share
 * names and field positions.
 *
 *   native → embed   `set-view` | `set-entity` | `set-theme`
 *   embed  → native  `ready`    | `navigate`   | `error`
 */

import type { ColorScheme } from '../lib/theme'

export type EmbedView = `chat` | `state-explorer`

export type NativeToEmbedMessage =
  | { type: `set-view`; view: EmbedView }
  | { type: `set-entity`; entityUrl: string }
  | { type: `set-theme`; theme: ColorScheme }

export type EmbedToNativeMessage =
  | { type: `ready` }
  | { type: `navigate`; pathname: string }
  | { type: `error`; message: string }

/**
 * Parse a raw `WebViewMessageEvent.nativeEvent.data` payload, returning
 * the bridge message if it's well-formed, otherwise `null`. Intentionally
 * narrow — anything that doesn't match the protocol is dropped instead of
 * coerced.
 */
export function parseEmbedMessage(raw: string): EmbedToNativeMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== `object` || !(`type` in parsed)) return null
  const type = (parsed as { type: unknown }).type
  switch (type) {
    case `ready`:
      return { type: `ready` }
    case `navigate`: {
      const pathname = (parsed as { pathname?: unknown }).pathname
      if (typeof pathname !== `string`) return null
      return { type: `navigate`, pathname }
    }
    case `error`: {
      const message = (parsed as { message?: unknown }).message
      if (typeof message !== `string`) return null
      return { type: `error`, message }
    }
    default:
      return null
  }
}

/**
 * Serialise a `set-*` message for `WebView.postMessage`.
 */
export function encodeNativeToEmbed(message: NativeToEmbedMessage): string {
  return JSON.stringify(message)
}
