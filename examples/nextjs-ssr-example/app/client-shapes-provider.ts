"use client"

import { cacheShapeState } from "@electric-sql/react"
import { getUrl, SerializedShape } from "./utils"

export default function ClientShapeProvider({
  children,
  serializedShapes,
}: {
  children: React.JSX.Element
  serializedShapes: SerializedShape[]
}) {
  for (const { options, data } of serializedShapes) {
    const newShapeOptions = { ...options, url: getUrl() }
    cacheShapeState(newShapeOptions, data)
  }
  return children
}
