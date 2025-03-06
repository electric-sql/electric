import {
  ShapeStream,
  ShapeStreamInterface,
  ShapeStreamOptions,
} from '../../src/client'
import { Client, ClientConfig } from 'pg'
import { Message, Row } from '../../src/types'
import { isChangeMessage } from '../..//src'
import { isUpToDateMessage } from '../../src/helpers'

export function makePgClient(overrides: ClientConfig = {}) {
  return new Client({
    host: `localhost`,
    port: 54321,
    password: `password`,
    user: `postgres`,
    database: `electric`,
    options: `-csearch_path=electric_test`,
    ...overrides,
  })
}

export function forEachMessage<T extends Row<unknown>>(
  stream: ShapeStreamInterface<T>,
  controller: AbortController,
  handler: (
    resolve: () => void,
    message: Message<T>,
    nthDataMessage: number
  ) => Promise<void> | void
) {
  let unsub = () => {}
  return new Promise<void>((resolve, reject) => {
    let messageIdx = 0

    unsub = stream.subscribe(async (messages) => {
      for (const message of messages) {
        try {
          await handler(
            () => {
              controller.abort()
              return resolve()
            },
            message as Message<T>,
            messageIdx
          )
          if (`operation` in message.headers) messageIdx++
        } catch (e) {
          controller.abort()
          return reject(e)
        }
      }
    }, reject)
  }).finally(unsub)
}

export async function waitForTransaction({
  baseUrl,
  table,
  numChangesExpected,
  shapeStreamOptions,
}: {
  baseUrl: string
  table: string
  numChangesExpected?: number
  shapeStreamOptions?: Partial<ShapeStreamOptions>
}): Promise<Pick<ShapeStreamOptions, `offset` | `handle`>> {
  const aborter = new AbortController()
  const issueStream = new ShapeStream({
    ...(shapeStreamOptions ?? {}),
    url: `${baseUrl}/v1/shape`,
    params: {
      ...(shapeStreamOptions?.params ?? {}),
      table,
    },
    signal: aborter.signal,
    subscribe: true,
  })

  numChangesExpected ??= 1
  let numChangesSeen = 0
  await forEachMessage(issueStream, aborter, (res, msg) => {
    if (isChangeMessage(msg)) {
      numChangesSeen++
    }

    if (numChangesSeen >= numChangesExpected && isUpToDateMessage(msg)) {
      res()
    }
  })
  return {
    offset: issueStream.lastOffset,
    handle: issueStream.shapeHandle,
  }
}
