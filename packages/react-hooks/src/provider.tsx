'use client'
import React from 'react'
import type { SerializedShapeData } from './react-hooks'
import { deserializeShape, serializeShape } from './react-hooks'
import { shapeCache, streamCache, sortedOptionsHash } from './react-hooks'
import { Shape, ShapeStream } from '@electric-sql/client'
import type { Row } from '@electric-sql/client'

const isSSR = typeof window === 'undefined' || 'Deno' in globalThis

type ElectricScriptProps = {
  shapes: Shape<Row<unknown>>[]
}

const ElectricScript = ({ shapes }: ElectricScriptProps) => {
  if (!isSSR) {
    return null
  }

  const isLoading = shapes.some((shape) => shape.isLoading())

  if (isLoading) {
    return null
  }

  const serializedShapes = shapes.reduce<SerializedShapeData[]>(
    (serializedShapes, shape) => {
      return [...serializedShapes, serializeShape(shape)]
    },
    []
  )

  return (
    <script
      id="__ELECTRIC_SSR_STATE__"
      type="application/json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(serializedShapes),
      }}
    />
  )
}

export function ElectricProvider({ children }: { children: React.ReactNode }) {
  const shapeCacheRef = React.useRef<typeof shapeCache>(shapeCache)
  const streamCacheRef = React.useRef<typeof streamCache>(streamCache)

  if (!isSSR) {
    const ssrData = document?.getElementById('__ELECTRIC_SSR_STATE__')
    const serializedShapes: Array<SerializedShapeData> =
      JSON.parse(ssrData?.textContent ?? '[]') ?? []

    for (const serializedShape of serializedShapes) {
      const isEmpty = Object.keys(serializedShape.value).length === 0

      if (isEmpty) {
        continue
      }

      const shape = deserializeShape(serializedShape)
      const stream = shape.stream as ShapeStream<Row<unknown>>

      const hash = sortedOptionsHash(shape.stream.options)
      streamCacheRef.current.set(hash, stream)
      shapeCacheRef.current.set(stream, shape)
    }
  }

  const shapes = Array.from(shapeCacheRef.current.values())

  return (
    <>
      {children}
      <ElectricScript shapes={shapes} />
    </>
  )
}
