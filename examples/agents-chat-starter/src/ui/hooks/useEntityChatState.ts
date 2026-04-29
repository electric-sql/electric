import { useState, useEffect } from 'react'
import { createAgentsClient, entity } from '@electric-ax/agents-runtime'
import { useChat } from '@electric-ax/agents-runtime/react'
import type { EntityStreamDB } from '@electric-ax/agents-runtime'
import type { EntityTimelineState } from '@electric-ax/agents-runtime'

/**
 * Observes a single agent entity stream and returns its chat state
 * using the useChat hook. This is more reliable than using entity
 * listing status for detecting when an agent is actively generating.
 */
export function useEntityChatState(
  agentsUrl: string | null,
  entityUrl: string | null
): EntityTimelineState {
  const [db, setDb] = useState<EntityStreamDB | null>(null)

  useEffect(() => {
    if (!agentsUrl || !entityUrl) {
      setDb(null)
      return
    }

    let cancelled = false
    let observedDb: EntityStreamDB | null = null
    const client = createAgentsClient({ baseUrl: agentsUrl })

    client
      .observe(entity(entityUrl))
      .then((observed) => {
        observedDb = observed as EntityStreamDB
        if (cancelled) {
          observedDb.close()
          return
        }
        setDb(observedDb)
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(`Failed to observe entity ${entityUrl}:`, err)
        }
      })

    return () => {
      cancelled = true
      observedDb?.close()
    }
  }, [agentsUrl, entityUrl])

  const chat = useChat(db)
  return chat.state
}
