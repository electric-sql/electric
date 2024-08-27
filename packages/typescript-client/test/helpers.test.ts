import { describe, expect, it } from 'vitest'
import { isChangeMessage, isControlMessage, Message } from '../src'

describe(`helpers`, () => {
  it(`should correctly detect ChangeMessages`, () => {
    const message = {
      headers: {
        operation: `insert`,
      },
      offset: `-1`,
      key: `key`,
      value: { key: `value` },
    } as Message

    expect(isChangeMessage(message)).toBe(true)
    expect(isControlMessage(message)).toBe(false)
  })

  it(`should correctly detect ControlMessages`, () => {
    const message = {
      headers: {
        control: `up-to-date`,
      },
    } as Message
    expect(isControlMessage(message)).toBe(true)
    expect(isChangeMessage(message)).toBe(false)
  })
})
