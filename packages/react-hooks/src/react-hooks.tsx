import { Row, Shape, GetExtensions, ShapeStream, ShapeStreamOptions } from '@electric-sql/client'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector.js'
import {
  UseShapeOptions,
  UseShapeResult,
  ShapeClient,
  identity,
  parseShapeData,
  shapeSubscribe,
  sortedOptionsHash,
  SSRState,
  isSSR,
} from './core'
import { useEffect, useRef, useCallback } from 'react'


// Client for module
let moduleClient: ShapeClient
function getClient() {
  console.log({ ShapeClient })
  if (!moduleClient) {
    moduleClient = new ShapeClient()
  }

  return moduleClient
}

// Export shape functions from the module client
export function getShapeStream<T extends Row<unknown>>(
  options: ShapeStreamOptions<GetExtensions<T>>
): ShapeStream<T> {
  const optionsHash = sortedOptionsHash(options)
  return getClient().getShapeStream(options, optionsHash)
}

export function getShape<T extends Row<unknown>>(
  shapeStream: ShapeStream<T>
): Shape<T> {
  return getClient().getShape(shapeStream)
}

// Hydrate SSR state on first mount
let hasHydrated = false
function hydrateSSRState() {
  if (hasHydrated || isSSR) return

  const doc = (globalThis as any).document
  const stateEl = doc?.getElementById('__ELECTRIC_SSR_STATE__')
  if (!stateEl?.textContent) return

  try {
    const state = JSON.parse(stateEl.textContent) as SSRState
    getClient().hydrateFromState(state)
    hasHydrated = true
  } catch (e) {
    console.error('Failed to hydrate SSR state:', e)
  }
}

export function useShape<SourceData extends Row<unknown>, Selection = UseShapeResult<SourceData>>({
  selector = identity as (arg: UseShapeResult<SourceData>) => Selection,
  ...options
}: UseShapeOptions<SourceData, Selection>): Selection {
  const optionsHash = sortedOptionsHash(options)
  const firstMount = useRef(true)

  // Hydrate SSR state on first mount of any shape
  useEffect(() => {
    if (firstMount.current) {
      hydrateSSRState()
      firstMount.current = false
    }
  }, [])

  const shapeStream = getClient().getShapeStream(options, optionsHash)
  const shape = getClient().getShape(shapeStream)

  const getSnapshot = useCallback(() => parseShapeData(shape), [shape])

  return useSyncExternalStoreWithSelector(
    (onChange) => shapeSubscribe(shape, onChange),
    getSnapshot,
    getSnapshot,
    selector
  )
}

// Re-export types
export type { UseShapeOptions, UseShapeResult } from './core'
