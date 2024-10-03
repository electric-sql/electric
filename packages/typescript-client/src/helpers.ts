import { ChangeMessage, ControlMessage, Message, Row } from './types'

/**
 * Type guard for checking {@link Message} is {@link ChangeMessage}.
 *
 * See [TS docs](https://www.typescriptlang.org/docs/handbook/advanced-types.html#user-defined-type-guards)
 * for information on how to use type guards.
 *
 * @param message - the message to check
 * @returns true if the message is a {@link ChangeMessage}
 *
 * @example
 * ```ts
 * if (isChangeMessage(message)) {
 *   const msgChng: ChangeMessage = message // Ok
 *   const msgCtrl: ControlMessage = message // Err, type mismatch
 * }
 * ```
 */
export function isChangeMessage<T extends Row<unknown> = Row>(
  message: Message<T>
): message is ChangeMessage<T> {
  return `key` in message
}

/**
 * Type guard for checking {@link Message} is {@link ControlMessage}.
 *
 * See [TS docs](https://www.typescriptlang.org/docs/handbook/advanced-types.html#user-defined-type-guards)
 * for information on how to use type guards.
 *
 * @param message - the message to check
 * @returns true if the message is a {@link ControlMessage}
 *
 *  * @example
 * ```ts
 * if (isControlMessage(message)) {
 *   const msgChng: ChangeMessage = message // Err, type mismatch
 *   const msgCtrl: ControlMessage = message // Ok
 * }
 * ```
 */
export function isControlMessage<T extends Row<unknown> = Row>(
  message: Message<T>
): message is ControlMessage {
  return !isChangeMessage(message)
}

export function isUpToDateMessage<T extends Row<unknown> = Row>(
  message: Message<T>
): message is ControlMessage & { up_to_date: true } {
  return isControlMessage(message) && message.headers.control === `up-to-date`
}
