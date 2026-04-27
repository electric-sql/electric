import { useState, useEffect, useRef } from 'react'
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
  const cleanupRef = useRef<Array<() => void>>([])

  useEffect(() => {
    if (!agentsUrl || !roomId) {
      setMessagesCollection(null)
      setAgentsCollection(null)
      setConnected(false)
      return
    }

    let cancelled = false

    async function connect() {
      try {
        const client = createAgentsClient({ baseUrl: agentsUrl! })

        // Track agents in the room by tag
        const entitiesDb = await client.observe(
          entities({ tags: { room_id: roomId! } })
        )
        const members = (entitiesDb as any).collections
          .members as AgentsCollection
        if (!cancelled) setAgentsCollection(members)

        // Subscribe to chatroom shared state with retry
        // (agents need time to create the shared state via ctx.mkdb())
        const chatroomDb = await retry(async () => {
          return await client.observe(db(roomId!, chatroomSchema))
        })
        const messages = (chatroomDb as any).collections
          .messages as MessagesCollection
        if (!cancelled) {
          setMessagesCollection(messages)
          setConnected(true)
          setError(null)
        }

        cleanupRef.current.push(
          () => (entitiesDb as any).close?.(),
          () => (chatroomDb as any).close?.()
        )
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
      for (const cleanup of cleanupRef.current) cleanup()
      cleanupRef.current = []
    }
  }, [agentsUrl, roomId])

  return { messagesCollection, agentsCollection, connected, error }
}
