import { describe, expect, it } from 'vitest'
import { encodeNativeToEmbed, parseEmbedMessage } from '../bridge'

/**
 * Coverage for the native-side bridge module. The protocol is shared
 * with `packages/agents-server-ui/src/embed/bridge.ts` — keep these
 * cases in sync with the embed-side test so a wire change can't drift
 * between the two.
 */

describe(`native bridge`, () => {
  describe(`encodeNativeToEmbed`, () => {
    it(`serialises set-view`, () => {
      expect(encodeNativeToEmbed({ type: `set-view`, view: `chat` })).toBe(
        `{"type":"set-view","view":"chat"}`
      )
      expect(
        encodeNativeToEmbed({ type: `set-view`, view: `state-explorer` })
      ).toBe(`{"type":"set-view","view":"state-explorer"}`)
    })

    it(`serialises set-entity`, () => {
      expect(
        encodeNativeToEmbed({ type: `set-entity`, entityUrl: `/horton/abc` })
      ).toBe(`{"type":"set-entity","entityUrl":"/horton/abc"}`)
    })

    it(`serialises set-theme`, () => {
      expect(encodeNativeToEmbed({ type: `set-theme`, theme: `dark` })).toBe(
        `{"type":"set-theme","theme":"dark"}`
      )
      expect(encodeNativeToEmbed({ type: `set-theme`, theme: `light` })).toBe(
        `{"type":"set-theme","theme":"light"}`
      )
    })
  })

  describe(`parseEmbedMessage`, () => {
    it(`parses ready`, () => {
      expect(parseEmbedMessage(`{"type":"ready"}`)).toEqual({ type: `ready` })
    })

    it(`parses navigate with pathname`, () => {
      expect(
        parseEmbedMessage(`{"type":"navigate","pathname":"/entity/horton/abc"}`)
      ).toEqual({ type: `navigate`, pathname: `/entity/horton/abc` })
    })

    it(`parses error with message`, () => {
      expect(parseEmbedMessage(`{"type":"error","message":"boom"}`)).toEqual({
        type: `error`,
        message: `boom`,
      })
    })

    it(`returns null on malformed JSON`, () => {
      expect(parseEmbedMessage(`not-json`)).toBeNull()
      expect(parseEmbedMessage(``)).toBeNull()
    })

    it(`returns null when payload isn't an object`, () => {
      expect(parseEmbedMessage(`null`)).toBeNull()
      expect(parseEmbedMessage(`42`)).toBeNull()
      expect(parseEmbedMessage(`"hello"`)).toBeNull()
    })

    it(`returns null when type is missing or unknown`, () => {
      expect(parseEmbedMessage(`{}`)).toBeNull()
      expect(parseEmbedMessage(`{"foo":"bar"}`)).toBeNull()
      expect(parseEmbedMessage(`{"type":"set-view","view":"chat"}`)).toBeNull()
    })

    it(`drops navigate without pathname`, () => {
      expect(parseEmbedMessage(`{"type":"navigate"}`)).toBeNull()
      expect(parseEmbedMessage(`{"type":"navigate","pathname":42}`)).toBeNull()
    })

    it(`drops error without message`, () => {
      expect(parseEmbedMessage(`{"type":"error"}`)).toBeNull()
      expect(parseEmbedMessage(`{"type":"error","message":null}`)).toBeNull()
    })

    it(`encode + parse round-trips for known wire-compatible payloads`, () => {
      // The `ready` and `navigate` shapes are intentionally identical
      // on both sides so this round-trip keeps the two parsers in
      // lockstep. Native only sends `set-*` messages, but tests for
      // those live in the embed test (the symmetric counterpart).
      const ready = `{"type":"ready"}`
      expect(JSON.stringify(parseEmbedMessage(ready))).toBe(ready)

      const navigate = `{"type":"navigate","pathname":"/entity/x"}`
      expect(JSON.stringify(parseEmbedMessage(navigate))).toBe(navigate)
    })
  })
})
