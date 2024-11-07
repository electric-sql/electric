import {
  Offset,
  Shape,
  ShapeData,
  ShapeStreamOptions,
} from "@electric-sql/client/*"

export type ShapeDefintion = {
  table: string
  columns?: string[]
  where?: string
}

export type ShapeDefinitionWithPosiotion = ShapeDefintion & {
  offset: Offset
  shapeHandle: string | undefined
}

export type SerializedShape = {
  options: ShapeDefinitionWithPosiotion
  data: ShapeData
}

export function getUrl() {
  if (typeof window === `undefined`) {
    return `${process.env.ELECTRIC_URL || `http://localhost:3000`}/v1/shape`
  }
  return `${window?.location.origin}/shape-proxy/v1/shape`
}

export function getProxiedOptions(
  options: Omit<ShapeStreamOptions, "url">
): ShapeStreamOptions {
  // ensure shape is not syncing on the server
  const serverOptions: Partial<ShapeStreamOptions> = {}
  if (typeof window === `undefined`) {
    const controller = new AbortController()
    controller.abort()
    serverOptions.signal = controller.signal
    serverOptions.subscribe = false
  }

  return { ...options, ...serverOptions, url: getUrl() }
}
