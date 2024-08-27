import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ChangeMessage,
  ControlMessage,
  isChangeMessage,
  isControlMessage,
  Message,
} from '../src'

describe('helpers', () => {
  it('should respect ChangeMessages type guard', () => {
    const message = {
      headers: {
        operation: 'insert',
      },
      offset: '-1',
      key: 'key',
      value: { key: 'value' },
    } as Message<any>

    if (isChangeMessage(message)) {
      const msgChng: ChangeMessage<any> = message
      expectTypeOf(msgChng).toEqualTypeOf<ChangeMessage<any>>()

      // @ts-expect-error - should have type mismatch
      message as ControlMessage
    }
  })

  it('should respect ControlMessages type guard', () => {
    const message = {
      headers: {
        control: 'up-to-date',
      },
    } as Message<any>

    if (isControlMessage(message)) {
      const msgCtrl: ControlMessage = message
      expectTypeOf(msgCtrl).toEqualTypeOf<ControlMessage>()

      // @ts-expect-error - should have type mismatch
      message as ChangeMessage<any>
    }
  })
})
