import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createLivingWikiApiClient,
  type LivingWikiApiClient,
  type LivingWikiSharedStateSnapshot,
} from '../api/livingWikiApi'
import type { WikiStateDashboardViewModel } from '../components/wiki-state/WikiStateDashboard'
import {
  selectMemberCards,
  selectRecentActivity,
  selectReviewQueueSummary,
  selectSourcesByStatus,
  selectWikiGraphSummary,
  selectWikiPageCards,
} from '../selectors/wikiStateViewModels'

export type UseLivingWikiStateSnapshotOptions = {
  wikiSpaceId: string
  client?: LivingWikiApiClient
}

export type UseLivingWikiStateSnapshotResult = {
  viewModel: WikiStateDashboardViewModel
  loading: boolean
  error: Error | null
  refresh: () => Promise<void>
}

const emptySnapshot: LivingWikiSharedStateSnapshot = {
  wiki_spaces: [],
  actors: [],
  memberships: [],
  activity_events: [],
  sources: [],
  wiki_pages: [],
  wiki_links: [],
  review_items: [],
  agent_runs: [],
}

export function snapshotToViewModel(
  snapshot: LivingWikiSharedStateSnapshot
): WikiStateDashboardViewModel {
  return {
    activityEvents: selectRecentActivity(snapshot.activity_events),
    members: selectMemberCards(snapshot.memberships, snapshot.actors),
    sources: selectSourcesByStatus(snapshot.sources),
    graphSummary: selectWikiGraphSummary(
      snapshot.wiki_pages,
      snapshot.wiki_links
    ),
    pageCards: selectWikiPageCards(snapshot.wiki_pages),
    reviewSummary: selectReviewQueueSummary(snapshot.review_items),
    reviewItems: snapshot.review_items,
  }
}

export function useLivingWikiStateSnapshot({
  wikiSpaceId,
  client,
}: UseLivingWikiStateSnapshotOptions): UseLivingWikiStateSnapshotResult {
  const mounted = useRef(false)
  const requestId = useRef(0)
  const defaultClient = useRef<LivingWikiApiClient | undefined>(undefined)
  const resolvedClient =
    client ?? (defaultClient.current ??= createLivingWikiApiClient())
  const [snapshot, setSnapshot] =
    useState<LivingWikiSharedStateSnapshot>(emptySnapshot)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    setLoading(true)
    setError(null)

    try {
      const next = await resolvedClient.getSharedStateSnapshot({ wikiSpaceId })
      if (mounted.current && requestId.current === currentRequest) {
        setSnapshot(next)
      }
    } catch (nextError) {
      if (mounted.current && requestId.current === currentRequest) {
        setError(
          nextError instanceof Error ? nextError : new Error(String(nextError))
        )
      }
    } finally {
      if (mounted.current && requestId.current === currentRequest) {
        setLoading(false)
      }
    }
  }, [resolvedClient, wikiSpaceId])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
    }
  }, [refresh])

  const viewModel = useMemo(() => snapshotToViewModel(snapshot), [snapshot])

  return { viewModel, loading, error, refresh }
}
