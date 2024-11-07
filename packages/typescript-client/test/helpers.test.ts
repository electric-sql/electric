import { describe, expect, it } from 'vitest'
import { isChangeMessage, isControlMessage, Message } from '../src'
import { isFrontierMessage } from '../src/helpers'

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
      control: `frontier`,
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

  it(`should correctly detect frontier message`, () => {
    expect(isFrontierMessage(upToDateMsg)).toBe(true)
    expect(isFrontierMessage(mustRefetchMsg)).toBe(false)
    expect(isFrontierMessage(changeMsg)).toBe(false)
  })
})
