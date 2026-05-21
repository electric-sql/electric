import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  createEntitiesCollection,
  createEntityTypesCollection,
  createRunnersCollection,
  signalEntity,
  type EntitiesCollection,
  type EntityTypesCollection,
  type EntitySignal,
  type RunnersCollection,
} from './agentsClient'

type AgentsContextValue = {
  serverUrl: string
  entitiesCollection: EntitiesCollection
  entityTypesCollection: EntityTypesCollection
  runnersCollection: RunnersCollection
  signalEntity: (input: {
    entityUrl: string
    signal: EntitySignal
    reason?: string
    payload?: unknown
  }) => Promise<void>
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
      runnersCollection: createRunnersCollection(serverUrl),
      signalEntity: (input) => signalEntity({ baseUrl: serverUrl, ...input }),
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
