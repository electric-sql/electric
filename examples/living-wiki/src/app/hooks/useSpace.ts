import { useCallback, useEffect, useState } from 'react'
import { createLivingWikiApiClient } from '../api/livingWikiApi'
import type {
  CreateSpaceInput,
  JoinSpaceInput,
  WikiSpaceSnapshot,
} from '../../shared/space'
import { writeDemoSessionIdentity } from '../../shared/session'

export type UseSpaceResult = {
  space: WikiSpaceSnapshot | null
  loading: boolean
  error: Error | null
  refresh: () => Promise<WikiSpaceSnapshot | null>
}

export type UseCreateSpaceResult = {
  createSpace: (input: CreateSpaceInput) => Promise<WikiSpaceSnapshot>
  loading: boolean
  error: Error | null
}

export type UseJoinSpaceInput = Omit<JoinSpaceInput, `wikiSpaceId`>

export type UseJoinSpaceResult = {
  joinSpace: (input: UseJoinSpaceInput) => Promise<WikiSpaceSnapshot>
  loading: boolean
  error: Error | null
}

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(`Request failed`)

const browserStorage = (): Pick<Storage, `setItem`> | null => {
  if (typeof window === `undefined`) {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

const persistCurrentActor = (snapshot: WikiSpaceSnapshot): void => {
  const storage = browserStorage()

  if (storage === null) {
    return
  }

  writeDemoSessionIdentity(storage, {
    actorId: snapshot.currentActor.id,
    displayName: snapshot.currentActor.displayName,
    avatarColor: snapshot.currentActor.avatarColor,
  })
}

export function useSpace(
  wikiSpaceId: string,
  actorId?: string
): UseSpaceResult {
  const [space, setSpace] = useState<WikiSpaceSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const snapshot = await createLivingWikiApiClient().getSpace({
        wikiSpaceId,
        actorId,
      })
      setSpace(snapshot)
      return snapshot
    } catch (caughtError) {
      const error = toError(caughtError)
      setError(error)
      setSpace(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [actorId, wikiSpaceId])

  useEffect(() => {
    let active = true

    setLoading(true)
    setError(null)

    createLivingWikiApiClient()
      .getSpace({ wikiSpaceId, actorId })
      .then((snapshot) => {
        if (!active) return
        setSpace(snapshot)
      })
      .catch((caughtError: unknown) => {
        if (!active) return
        setError(toError(caughtError))
        setSpace(null)
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [actorId, wikiSpaceId])

  return { space, loading, error, refresh }
}

export function useCreateSpace(): UseCreateSpaceResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const createSpace = useCallback(async (input: CreateSpaceInput) => {
    setLoading(true)
    setError(null)

    try {
      const snapshot = await createLivingWikiApiClient().createSpace(input)
      persistCurrentActor(snapshot)
      return snapshot
    } catch (caughtError) {
      const error = toError(caughtError)
      setError(error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [])

  return { createSpace, loading, error }
}

export function useJoinSpace(wikiSpaceId: string): UseJoinSpaceResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const joinSpace = useCallback(
    async (input: UseJoinSpaceInput) => {
      setLoading(true)
      setError(null)

      try {
        const snapshot = await createLivingWikiApiClient().joinSpace({
          wikiSpaceId,
          ...input,
        })
        persistCurrentActor(snapshot)
        return snapshot
      } catch (caughtError) {
        const error = toError(caughtError)
        setError(error)
        throw error
      } finally {
        setLoading(false)
      }
    },
    [wikiSpaceId]
  )

  return { joinSpace, loading, error }
}
