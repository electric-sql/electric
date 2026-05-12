import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  createEntitiesCollection,
  createEntityTypesCollection,
  type EntitiesCollection,
  type EntityTypesCollection,
} from './agentsClient'

type AgentsContextValue = {
  serverUrl: string
  entitiesCollection: EntitiesCollection
  entityTypesCollection: EntityTypesCollection
}

const AgentsContext = createContext<AgentsContextValue | null>(null)

export function AgentsProvider({
  serverUrl,
  children,
}: {
  serverUrl: string
  children: ReactNode
}): React.ReactElement {
  const value = useMemo<AgentsContextValue>(() => {
    return {
      serverUrl,
      entitiesCollection: createEntitiesCollection(serverUrl),
      entityTypesCollection: createEntityTypesCollection(serverUrl),
    }
  }, [serverUrl])

  return (
    <AgentsContext.Provider value={value}>{children}</AgentsContext.Provider>
  )
}

export function useAgents(): AgentsContextValue {
  const value = useContext(AgentsContext)
  if (!value) {
    throw new Error(`useAgents must be used inside AgentsProvider`)
  }
  return value
}
