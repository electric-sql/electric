import { Client, ClientConfig } from "pg"
import {
  isChangeMessage,
  isControlMessage,
  ShapeStream,
  ShapeStreamInterface,
  ShapeStreamOptions,
  type Message,
  type Row,
} from "@electric-sql/client"

export function makePgClient(overrides: ClientConfig = {}) {
  return new Client({
    host: "localhost",
    port: 54321,
    password: "password",
    user: "postgres",
    database: "electric",
    options: "-csearch_path=electric_test",
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
  return new Promise<void>((resolve, reject) => {
    let messageIdx = 0

    stream.subscribe(async (messages) => {
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
          if ("operation" in message.headers) messageIdx++
        } catch (e) {
          controller.abort()
          return reject(e)
        }
      }
    }, reject)
  })
}

export async function waitForTransaction({
  baseUrl,
  table,
  numChangesExpected,
  shapeStreamOptions,
  aborter,
}: {
  baseUrl: string
  table: string
  numChangesExpected?: number
  shapeStreamOptions?: Partial<ShapeStreamOptions>
  aborter?: AbortController
}): Promise<Pick<ShapeStreamOptions, "offset" | "handle">> {
  const waitAborter = new AbortController()
  if (aborter?.signal.aborted) waitAborter.abort()
  else aborter?.signal.addEventListener("abort", () => waitAborter.abort())
  const issueStream = new ShapeStream({
    ...(shapeStreamOptions ?? {}),
    url: `${baseUrl}/v1/shape`,
    params: {
      ...(shapeStreamOptions?.params ?? {}),
      table,
    },
    signal: waitAborter.signal,
    subscribe: true,
  })

  numChangesExpected ??= 1
  let numChangesSeen = 0
  await forEachMessage(issueStream, waitAborter, (res, msg) => {
    if (isChangeMessage(msg)) {
      numChangesSeen++
    }

    if (
      numChangesSeen >= numChangesExpected &&
      isControlMessage(msg) &&
      msg.headers.control === "up-to-date"
    ) {
      res()
    }
  })
  return {
    offset: issueStream.lastOffset,
    handle: issueStream.shapeHandle,
  }
}
