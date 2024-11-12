import {
  ChangeMessage,
  GetExtensions,
  isControlMessage,
  Message,
  Publisher,
  Row,
  ShapeStream,
  ShapeStreamInterface,
  ShapeStreamOptions,
} from "@electric-sql/client/"

// Reduce all changes for a shape into a single value.
// Batches all changes until a control message is received.
export type ReduceFunction<T extends Row<unknown>, Y> = (
  acc: Y,
  message: ChangeMessage<T>
) => Y

export class ReduceStream<T extends Row<unknown>, Y>
  extends Publisher<{ acc: Y }>
  implements ShapeStreamInterface<{ acc: Y }>
{
  readonly #stream: ShapeStream<T>
  options: ShapeStreamOptions<GetExtensions<T>>

  readonly #callback: ReduceFunction<T, Y>
  #accMessage: ChangeMessage<{ acc: Y }>

  constructor(stream: ShapeStream<T>, callback: ReduceFunction<T, Y>, init: Y) {
    super()
    this.#stream = stream
    this.options = stream.options
    this.#callback = callback
    this.#accMessage = getInitAccMessage(this.options.table!, init)

    stream.subscribe((messages) => {
      messages.map((message: Message<T>) => {
        const messages = []
        if (isControlMessage(message)) {
          if (message.headers.control === "up-to-date") {
            messages.push(this.#accMessage)
          }
          messages.push(message)
          this.publish(messages)
        } else {
          const current = this.#accMessage.value.acc
          const next = this.#callback(current, message)
          this.#accMessage = {
            ...message,
            key: this.options.table!,
            value: { acc: next },
          }
        }
      })
    })
  }

  get shapeHandle(): string {
    return this.#stream.shapeHandle
  }
  get isUpToDate(): boolean {
    return this.#stream.isUpToDate
  }
  get error(): unknown {
    return this.#stream.error
  }
  start(): Promise<void> {
    return this.#stream.start()
  }
  lastSyncedAt(): number | undefined {
    return this.#stream.lastSyncedAt()
  }
  lastSynced(): number {
    return this.#stream.lastSynced()
  }
  isConnected(): boolean {
    return this.#stream.isConnected()
  }
  isLoading(): boolean {
    return this.#stream.isLoading()
  }
}

function getInitAccMessage<Y>(
  key: string,
  value: Y
): ChangeMessage<{ acc: Y }> {
  return {
    headers: { operation: "insert" },
    offset: "-1",
    key: key,
    value: { acc: value },
  }
}

