import { useState, useEffect } from 'react'
import { createAgentsClient, entities, db } from '@electric-ax/agents-runtime'
import type { Collection } from '@tanstack/db'
import { chatroomSchema, type Message } from '../../server/schema.js'

interface EntityMember {
  url: string
  type: string
  status: string
  tags: Record<string, string>
  created_at: number
  updated_at: number
}

export type MessagesCollection = Collection<Message>
export type AgentsCollection = Collection<EntityMember>

async function retry<T>(
  fn: () => Promise<T>,
  attempts = 15,
  delay = 1000
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === attempts - 1) throw err
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error(`Unreachable`)
}

export function useChatroom(agentsUrl: string | null, roomId: string | null) {
  const [messagesCollection, setMessagesCollection] =
    useState<MessagesCollection | null>(null)
  const [agentsCollection, setAgentsCollection] =
    useState<AgentsCollection | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!agentsUrl || !roomId) {
      setMessagesCollection(null)
      setAgentsCollection(null)
      setConnected(false)
      return
    }

    let cancelled = false
    const cleanups: Array<() => void> = []

    async function connect() {
      try {
        const client = createAgentsClient({ baseUrl: agentsUrl! })

        const entitiesDb = await client.observe(
          entities({ tags: { room_id: roomId! } })
        )
        cleanups.push(() => (entitiesDb as any).close?.())
        const members = (entitiesDb as any).collections
          .members as AgentsCollection
        if (!cancelled) setAgentsCollection(members)

        const chatroomDb = await retry(async () => {
          if (cancelled) throw new Error(`cancelled`)
          return await client.observe(db(roomId!, chatroomSchema))
        })
        cleanups.push(() => (chatroomDb as any).close?.())
        const messages = (chatroomDb as any).collections
          .messages as MessagesCollection
        if (!cancelled) {
          setMessagesCollection(messages)
          setConnected(true)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setConnected(false)
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      for (const cleanup of cleanups) cleanup()
    }
  }, [agentsUrl, roomId])

  return { messagesCollection, agentsCollection, connected, error }
}
