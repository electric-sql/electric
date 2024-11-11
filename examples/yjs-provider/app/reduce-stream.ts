import {
  ChangeMessage,
  ControlMessage,
  GetExtensions,
  isControlMessage,
  Message,
  Publisher,
  Row,
  ShapeStream,
  ShapeStreamInterface,
  ShapeStreamOptions,
} from "@electric-sql/client/"

// Reduce all rows for a shape into a single value.
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
  #accMessage: Partial<ChangeMessage<{ acc: Y }>>
  #acc?: Y

  constructor(stream: ShapeStream<T>, callback: ReduceFunction<T, Y>, init: Y) {
    super()
    this.#stream = stream
    this.options = stream.options
    this.#callback = callback
    this.#accMessage = { value: { acc: init } }
    this.#acc = init

    stream.subscribe((messages) => {
      messages.map((message: Message<T>) => {
        const messages = []
        if (isControlMessage(message)) {
          if (this.#acc) {
            this.#accMessage.value = { acc: this.#acc! }
            this.#accMessage.key = this.options.table!
            messages.push(this.#accMessage as ChangeMessage<{ acc: Y }>)
            this.#acc = undefined
          }
          messages.push(message)
          this.publish(messages)
        } else {
          this.#acc = this.#callback(this.#acc!, message)
          this.#accMessage = { ...message, value: { acc: this.#acc } }
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
