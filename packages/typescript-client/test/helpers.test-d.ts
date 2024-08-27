import { describe, expectTypeOf, it } from 'vitest'
import {
  ChangeMessage,
  ControlMessage,
  isChangeMessage,
  isControlMessage,
  Message,
} from '../src'

describe(`helpers`, () => {
  it(`should respect ChangeMessages type guard`, () => {
    const message = {
      headers: {
        operation: `insert`,
      },
      offset: `-1`,
      key: `foo`,
      value: { foo: `bar` },
    } as Message<{ foo: string }>

    if (isChangeMessage(message)) {
      const msgChng: ChangeMessage<{ foo: string }> = message
      expectTypeOf(msgChng).toEqualTypeOf<ChangeMessage<{ foo: string }>>()

      // @ts-expect-error - should have type mismatch
      message as ControlMessage
    }
  })

  it(`should respect ControlMessages type guard`, () => {
    const message = {
      headers: {
        control: `up-to-date`,
      },
    } as Message<{ [key: string]: string }>

    if (isControlMessage(message)) {
      const msgCtrl: ControlMessage = message
      expectTypeOf(msgCtrl).toEqualTypeOf<ControlMessage>()

      // @ts-expect-error - should have type mismatch
      message as ChangeMessage<{ foo: string }>
    }
  })
})
