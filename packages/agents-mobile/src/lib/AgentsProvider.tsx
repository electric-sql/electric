import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  createEntitiesCollection,
  createEntityTypesCollection,
  createEntityEffectivePermissionsCollection,
  createRunnersCollection,
  createUsersCollection,
  forkEntity,
  signalEntity,
  type EntitiesCollection,
  type EntityEffectivePermissionsCollection,
  type EntityTypesCollection,
  type EntitySignal,
  type ForkPointer,
  type RunnersCollection,
  type UsersCollection,
} from './agentsClient'

type AgentsContextValue = {
  serverUrl: string
  entitiesCollection: EntitiesCollection
  entityTypesCollection: EntityTypesCollection
  runnersCollection: RunnersCollection
  usersCollection: UsersCollection
  entityEffectivePermissionsCollection: EntityEffectivePermissionsCollection
  signalEntity: (input: {
    entityUrl: string
    signal: EntitySignal
    reason?: string
    payload?: unknown
  }) => Promise<void>
  forkEntity: (input: {
    entityUrl: string
    pointer?: ForkPointer
  }) => Promise<{ url: string }>
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
      usersCollection: createUsersCollection(serverUrl),
      entityEffectivePermissionsCollection:
        createEntityEffectivePermissionsCollection(serverUrl),
      signalEntity: (input) => signalEntity({ baseUrl: serverUrl, ...input }),
      forkEntity: (input) => forkEntity({ baseUrl: serverUrl, ...input }),
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
