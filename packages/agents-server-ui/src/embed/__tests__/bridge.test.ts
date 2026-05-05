// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  postEmbedToNative,
  subscribeNativeToEmbed,
  type NativeToEmbedMessage,
} from '../bridge'

/**
 * Coverage for the embed-side bridge module. The protocol is shared
 * with `packages/agents-mobile/src/webview/bridge.ts` — keep these
 * cases in sync with the native parser so a wire change can't drift
 * between the two.
 */

describe(`embed bridge`, () => {
  describe(`postEmbedToNative`, () => {
    it(`serialises into a single JSON.stringify call`, () => {
      const postMessage = vi.fn()
      window.ReactNativeWebView = { postMessage }

      postEmbedToNative({ type: `ready` })
      postEmbedToNative({ type: `navigate`, pathname: `/entity/horton/abc` })
      postEmbedToNative({ type: `error`, message: `boom` })

      expect(postMessage).toHaveBeenCalledTimes(3)
      expect(postMessage.mock.calls[0]?.[0]).toBe(`{"type":"ready"}`)
      expect(postMessage.mock.calls[1]?.[0]).toBe(
        `{"type":"navigate","pathname":"/entity/horton/abc"}`
      )
      expect(postMessage.mock.calls[2]?.[0]).toBe(
        `{"type":"error","message":"boom"}`
      )
    })

    it(`is a no-op when not running inside a React Native WebView`, () => {
      window.ReactNativeWebView = undefined

      expect(() => postEmbedToNative({ type: `ready` })).not.toThrow()
    })
  })

  describe(`subscribeNativeToEmbed`, () => {
    let handler: ReturnType<typeof vi.fn>
    let unsubscribe: () => void

    beforeEach(() => {
      handler = vi.fn()
      unsubscribe = subscribeNativeToEmbed(
        handler as unknown as (message: NativeToEmbedMessage) => void
      )
    })

    afterEach(() => {
      unsubscribe()
    })

    function fireMessage(data: unknown, target: EventTarget = window): void {
      const event = new MessageEvent(`message`, { data })
      target.dispatchEvent(event)
    }

    const cases: Array<[string, NativeToEmbedMessage]> = [
      [`set-view`, { type: `set-view`, view: `chat` }],
      [
        `set-view (state-explorer)`,
        { type: `set-view`, view: `state-explorer` },
      ],
      [`set-entity`, { type: `set-entity`, entityUrl: `/horton/abc` }],
      [`set-theme dark`, { type: `set-theme`, theme: `dark` }],
      [`set-theme light`, { type: `set-theme`, theme: `light` }],
    ]

    for (const [name, message] of cases) {
      it(`forwards a well-formed ${name} message`, () => {
        fireMessage(JSON.stringify(message))
        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler).toHaveBeenCalledWith(message)
      })
    }

    it(`also listens on document (iOS WKWebView dispatch path)`, () => {
      fireMessage(JSON.stringify({ type: `set-view`, view: `chat` }), document)
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it(`ignores non-string event payloads`, () => {
      fireMessage({ type: `set-view`, view: `chat` })
      expect(handler).not.toHaveBeenCalled()
    })

    it(`ignores malformed JSON payloads`, () => {
      fireMessage(`not-json`)
      expect(handler).not.toHaveBeenCalled()
    })

    it(`ignores payloads without a "type" field`, () => {
      fireMessage(JSON.stringify({ view: `chat` }))
      expect(handler).not.toHaveBeenCalled()
    })

    it(`unsubscribe stops further deliveries`, () => {
      unsubscribe()
      fireMessage(JSON.stringify({ type: `set-view`, view: `chat` }))
      expect(handler).not.toHaveBeenCalled()
    })
  })
})
