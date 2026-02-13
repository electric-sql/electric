import { describe, expect, it } from 'vitest'
import { isChangeMessage, isControlMessage, Message } from '../src'
import { isUpToDateMessage } from '../src/helpers'

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
