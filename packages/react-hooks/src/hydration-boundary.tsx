'use client'
import React from 'react'
import { hydrateShape, dehydrateShape, HydratedShapeData } from './hydration'
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

  const hydratedShapes = shapes.reduce<HydratedShapeData[]>(
    (hydratedShapes, shape) => {
      return [...hydratedShapes, hydrateShape(shape)]
    },
    []
  )

  return (
    <script
      id="__ELECTRIC_SSR_STATE__"
      type="application/json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(hydratedShapes),
      }}
    />
  )
}

export function HydrationBoundary({ children }: { children: React.ReactNode }) {
  const shapeCacheRef = React.useRef<typeof shapeCache>(shapeCache)
  const streamCacheRef = React.useRef<typeof streamCache>(streamCache)
  const isHydratedRef = React.useRef<boolean>(false)

  if (!isSSR && !isHydratedRef.current) {
    const ssrData = document?.getElementById('__ELECTRIC_SSR_STATE__')
    const hydratedShapes: Array<HydratedShapeData> =
      JSON.parse(ssrData?.textContent ?? '[]') ?? []

    for (const hydratedShape of hydratedShapes) {
      const isEmpty = Object.keys(hydratedShape.value).length === 0

      if (isEmpty) {
        continue
      }

      const shape = dehydrateShape(hydratedShape)
      const stream = shape.stream as ShapeStream<Row<unknown>>

      const hash = sortedOptionsHash(shape.stream.options)
      streamCacheRef.current.set(hash, stream)
      shapeCacheRef.current.set(stream, shape)
    }

    isHydratedRef.current = true
  }

  const shapes = Array.from(shapeCacheRef.current.values())

  return (
    <>
      {children}
      <ElectricScript shapes={shapes} />
    </>
  )
}
