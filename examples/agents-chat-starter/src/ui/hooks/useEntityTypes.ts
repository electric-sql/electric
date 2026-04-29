import { useState, useEffect } from 'react'

export interface EntityType {
  name: string
  description: string
}

export function useEntityTypes(agentsUrl: string | null) {
  const [types, setTypes] = useState<EntityType[]>([])

  useEffect(() => {
    if (!agentsUrl) return

    fetch(`${agentsUrl}/_electric/entity-types`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => setTypes(data as EntityType[]))
      .catch((err) => console.error(`Failed to load entity types:`, err))
  }, [agentsUrl])

  return types
}
