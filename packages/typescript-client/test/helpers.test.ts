import { describe, expect, it } from 'vitest'
import { isChangeMessage, isControlMessage, Message } from '../src'
import { isUpToDateMessage, bigintSafeStringify } from '../src/helpers'

describe(`helpers`, () => {
  const changeMsg = {
    headers: {
      operation: `insert`,
    },
    offset: `-1`,
    key: `key`,
    value: { key: `value` },
  } as Message

  const upToDateMsg = {
    headers: {
      control: `up-to-date`,
    },
  } as Message

  const mustRefetchMsg = {
    headers: {
      control: `must-refetch`,
    },
  } as Message

  const eventMsg = {
    headers: {
      event: `move-out`,
      patterns: [{ pos: 0, value: `test` }],
    },
  } as Message

  it(`should correctly detect ChangeMessages`, () => {
    expect(isChangeMessage(changeMsg)).toBe(true)
    expect(isControlMessage(changeMsg)).toBe(false)
  })

  it(`should correctly detect ControlMessages`, () => {
    expect(isControlMessage(upToDateMsg)).toBe(true)
    expect(isControlMessage(mustRefetchMsg)).toBe(true)
    expect(isChangeMessage(upToDateMsg)).toBe(false)
    expect(isChangeMessage(mustRefetchMsg)).toBe(false)
  })

  it(`should correctly detect up-to-date message`, () => {
    expect(isUpToDateMessage(upToDateMsg)).toBe(true)
    expect(isUpToDateMessage(mustRefetchMsg)).toBe(false)
    expect(isUpToDateMessage(changeMsg)).toBe(false)
  })

  it(`should not classify EventMessages as ControlMessages`, () => {
    expect(isControlMessage(eventMsg)).toBe(false)
    expect(isChangeMessage(eventMsg)).toBe(false)
    expect(isUpToDateMessage(eventMsg)).toBe(false)
  })

  it(`should not classify messages without headers as ControlMessages`, () => {
    // Messages without headers can arrive from proxy/CDN interference
    // or unexpected server responses (e.g. 409 during initialization).
    const noHeadersMsg = {} as unknown as Message
    expect(isControlMessage(noHeadersMsg)).toBe(false)
    expect(isChangeMessage(noHeadersMsg)).toBe(false)
    expect(isUpToDateMessage(noHeadersMsg)).toBe(false)
  })

  describe(`bigintSafeStringify`, () => {
    it(`should serialize objects with BigInt values`, () => {
      const obj = { id: BigInt(`9223372036854775807`), name: `test` }
      expect(bigintSafeStringify(obj)).toBe(
        `{"id":"9223372036854775807","name":"test"}`
      )
    })

    it(`should handle nested BigInt values`, () => {
      const obj = { params: { '1': BigInt(42), '2': `hello` } }
      expect(bigintSafeStringify(obj)).toBe(`{"params":{"1":"42","2":"hello"}}`)
    })

    it(`should behave like JSON.stringify for non-BigInt values`, () => {
      const obj = { a: 1, b: `two`, c: true, d: null }
      expect(bigintSafeStringify(obj)).toBe(JSON.stringify(obj))
    })

    it(`should not throw for BigInt values where JSON.stringify would`, () => {
      const obj = { id: BigInt(123) }
      expect(() => JSON.stringify(obj)).toThrow(
        `Do not know how to serialize a BigInt`
      )
      expect(() => bigintSafeStringify(obj)).not.toThrow()
    })
  })

  it(`should handle null and undefined messages without throwing`, () => {
    // Null/undefined messages should not occur in normal operation, but
    // these guards protect against unexpected runtime values from
    // proxy/CDN interference or future code changes.
    expect(isChangeMessage(undefined as unknown as Message)).toBe(false)
    expect(isChangeMessage(null as unknown as Message)).toBe(false)
    expect(isControlMessage(undefined as unknown as Message)).toBe(false)
    expect(isControlMessage(null as unknown as Message)).toBe(false)
    expect(isUpToDateMessage(undefined as unknown as Message)).toBe(false)
    expect(isUpToDateMessage(null as unknown as Message)).toBe(false)
  })
})
