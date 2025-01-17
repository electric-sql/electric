"use client"

import * as React from 'react'
import { SSRState } from './core'

export interface HydrationBoundaryProps {
  state?: SSRState
  children?: React.ReactNode
}

// Component to inject shape states into the page
export function HydrationBoundary({
  children,
  state,
}: HydrationBoundaryProps) {
  const [hydrationQueue, setHydrationQueue] = React.useState<SSRState | undefined>()

  // Hydrate new shapes immediately during render
  React.useMemo(() => {
    if (state && typeof state === 'object') {
      const { shapes } = state
      if (!shapes) return

      // For now we hydrate everything immediately as we don't have a concept
      // of existing vs new shapes yet. This could be optimized later.
      setHydrationQueue(state)
    }
  }, [state])

  // Hydrate queued shapes after render
  React.useEffect(() => {
    if (hydrationQueue) {
      const { globalClient } = require('./react-hooks')
      if (globalClient) {
        globalClient.hydrateFromState(hydrationQueue)
      }
      setHydrationQueue(undefined)
    }
  }, [hydrationQueue])

  return children as React.ReactElement
}
