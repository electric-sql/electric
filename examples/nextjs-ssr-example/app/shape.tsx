import {
  isChangeMessage,
  isControlMessage,
  Message,
  Offset,
  Shape,
  ShapeData,
  ShapeStream,
} from "@electric-sql/client"

export type SSShape = {
  offset: Offset
  shapeId: string | null
  data?: Record<string, unknown>
}

type ShapeState = {
  stream: ShapeStream
  shape: Shape
  cached: ShapeData
  offset: Offset
  cachedOffset: Offset
}

let state: ShapeState | undefined = undefined

function getServerShape() {
  if (state !== undefined) {
    return state
  }

  const stream = new ShapeStream({
    url: `http://localhost:3001/shape-proxy/items`,
    // hack to avoid caching behaviour in next 14.
    // it should work with cache: `no-store` but it doesn't
    fetchClient: (...args) => {
      const _url: URL =
        args[0] instanceof URL ? args[0] : new URL(args[0] as string)
      _url.searchParams.set(`_rand`, Math.random().toString())
      return fetch(...args)
    },
  })
  const shape = new Shape(stream)

  state = {
    stream,
    shape,
    cached: shape.valueSync,
    offset: `-1`,
    cachedOffset: `-1`,
  }

  stream.subscribe((messages) => {
    messages.map((message: Message) => {
      if (
        isControlMessage(message) &&
        message.headers.control === `up-to-date`
      ) {
        state!.cached = state!.shape.valueSync
        state!.cachedOffset = state!.offset
      } else if (isChangeMessage(message)) {
        state!.offset = message.offset
      }
    })
  })

  return state
}

export function getShapeData(): SSShape {
  const { cached, cachedOffset, stream } = getServerShape()
  return {
    data: Object.fromEntries(cached),
    offset: cachedOffset,
    shapeId: stream[`shapeId`] ?? null,
  }
}
