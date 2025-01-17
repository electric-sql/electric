'use client'

import { Row } from '@electric-sql/client'
import { SSRShapeData } from "./core"

// Component to inject shape states into the page
export function ElectricStateHydration({
  states
}: {
  states: Map<string, SSRShapeData<Row<unknown>>>
}) {
  const serializedState = JSON.stringify({
    shapes: Object.fromEntries(states),
  })

  return (
    <script
      id="__ELECTRIC_SSR_STATE__"
      type="application/json"
      dangerouslySetInnerHTML={{
        __html: serializedState,
      }}
    />
  )
}
