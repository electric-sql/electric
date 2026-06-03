import { useCallback, useEffect, useRef, useState } from 'react'
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

  try {
    writeDemoSessionIdentity(storage, {
      actorId: snapshot.currentActor.id,
      displayName: snapshot.currentActor.displayName,
      avatarColor: snapshot.currentActor.avatarColor,
    })
  } catch {
    // Session persistence is best-effort and should not fail successful API calls.
  }
}

export function useSpace(
  wikiSpaceId: string,
  actorId?: string
): UseSpaceResult {
  const [space, setSpace] = useState<WikiSpaceSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const mountedRef = useRef(false)
  const requestIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (mountedRef.current) {
      if (mountedRef.current) {
        setLoading(true)
        setError(null)
      }
    }

    try {
      const snapshot = await createLivingWikiApiClient().getSpace({
        wikiSpaceId,
        actorId,
      })
      if (mountedRef.current && requestId === requestIdRef.current) {
        setSpace(snapshot)
      }
      return snapshot
    } catch (caughtError) {
      const error = toError(caughtError)
      if (mountedRef.current && requestId === requestIdRef.current) {
        setError(error)
        setSpace(null)
      }
      return null
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [actorId, wikiSpaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { space, loading, error, refresh }
}

export function useCreateSpace(): UseCreateSpaceResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const createSpace = useCallback(async (input: CreateSpaceInput) => {
    if (mountedRef.current) {
      setLoading(true)
      setError(null)
    }

    try {
      const snapshot = await createLivingWikiApiClient().createSpace(input)
      persistCurrentActor(snapshot)
      return snapshot
    } catch (caughtError) {
      const error = toError(caughtError)
      if (mountedRef.current) {
        setError(error)
      }
      throw error
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [])

  return { createSpace, loading, error }
}

export function useJoinSpace(wikiSpaceId: string): UseJoinSpaceResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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
        if (mountedRef.current) {
          setError(error)
        }
        throw error
      } finally {
        if (mountedRef.current) {
          setLoading(false)
        }
      }
    },
    [wikiSpaceId]
  )

  return { joinSpace, loading, error }
}
