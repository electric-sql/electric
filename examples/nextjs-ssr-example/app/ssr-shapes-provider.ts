"use client"

import { createContext } from "react"
import { SerializedShapeData, useShape } from "@electric-sql/react"
import { ShapeStreamOptions } from "@electric-sql/client/*"

export const SSRShapesContext = createContext({})

type SerializedShape = {
  serverOptions: ShapeStreamOptions
  data: SerializedShapeData
}

const getClientBaseUrl = () => window?.location.origin

export default function SSRShapesInitializer({
  children,
  serializedShapes,
}: {
  children: React.ReactNode
  serializedShapes: SerializedShape[]
}) {
  if (typeof window === `undefined`) {
    return children
  }

  for (const { serverOptions, data } of serializedShapes) {
    // FIX client url
    const clientUrl = new URL(`/shape-proxy/items`, getClientBaseUrl()).href
    const shapeOptions = {
      ...serverOptions,
      url: clientUrl,
      offset: data.offset,
      shapeId: data.shapeId,
    }

    const shapeData = new Map(Object.entries(data.data ?? new Map()))
    /* eslint-disable react-hooks/rules-of-hooks */
    useShape({ ...shapeOptions, shapeData })
  }

  return children
}
