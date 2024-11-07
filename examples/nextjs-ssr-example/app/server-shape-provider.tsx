import { getSerializedShape } from "@electric-sql/react"
import React from "react"
import ClientShapeProvider from "./client-shapes-provider"
import { getUrl, SerializedShape, ShapeDefintion } from "./utils"

export default function ServerShapeProvider({
  children,
  options,
}: {
  children: React.JSX.Element
  options: ShapeDefintion[]
}) {
  const clientShapes: SerializedShape[] = []
  for (const shapeOptions of options) {
    const serializedShape = getSerializedShape({
      ...shapeOptions,
      url: getUrl(),
    })

    const clientOptions = {
      table: shapeOptions.table,
      columns: shapeOptions.columns,
      where: shapeOptions.where,
      shapeHandle: serializedShape.shapeHandle,
      offset: serializedShape.offset,
    }

    clientShapes.push({
      options: clientOptions,
      data: serializedShape.data ?? new Map(),
    })
  }

  return (
    <ClientShapeProvider serializedShapes={clientShapes}>
      {children}
    </ClientShapeProvider>
  )
}
