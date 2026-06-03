import { useEffect, useMemo } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import type { WikiStateDashboardViewModel } from '../components/wiki-state/WikiStateDashboard'
import type {
  ActivityEventRow,
  ActorRow,
  MembershipRow,
  ReviewItemRow,
  SourceRow,
  WikiLinkRow,
  WikiPageRow,
} from '../../shared/wiki-state'
import {
  createLivingWikiStateDb,
  type LivingWikiStateDb,
} from '../db/wikiStateDb'
import {
  selectMemberCards,
  selectRecentActivity,
  selectReviewQueueSummary,
  selectSourcesByStatus,
  selectWikiGraphSummary,
  selectWikiPageCards,
} from '../selectors/wikiStateViewModels'

export type LivingWikiStateViewModels = WikiStateDashboardViewModel

export type LivingWikiStateQueryResult<T> = {
  data?: T[]
  isLoading?: boolean
  isError?: boolean
  status?: string
}

export type LivingWikiStateQueryAdapter = <T>(
  collection: unknown
) => LivingWikiStateQueryResult<T>

export interface UseLivingWikiStateViewModelsOptions {
  wikiSpaceId?: string
  actorId?: string
  db?: LivingWikiStateDb
  createDb?: (input: {
    wikiSpaceId: string
    actorId?: string
  }) => LivingWikiStateDb
  queryAdapter?: LivingWikiStateQueryAdapter
  ownLifecycle?: boolean
}

export type UseLivingWikiStateViewModelsResult = {
  viewModel: LivingWikiStateViewModels
  isLoading: boolean
  isError: boolean
}

const emptyViewModel: LivingWikiStateViewModels = {
  activityEvents: selectRecentActivity([]),
  members: selectMemberCards([], []),
  sources: selectSourcesByStatus([]),
  graphSummary: selectWikiGraphSummary([], []),
  pageCards: selectWikiPageCards([]),
  reviewSummary: selectReviewQueueSummary([]),
}

const defaultQueryAdapter: LivingWikiStateQueryAdapter = <T>(
  collection: unknown
) =>
  useLiveQuery((q) =>
    collection === undefined ? undefined : q.from({ row: collection as never })
  ) as LivingWikiStateQueryResult<T>

export function useLivingWikiStateViewModels({
  wikiSpaceId,
  actorId,
  db: providedDb,
  createDb = createLivingWikiStateDb,
  queryAdapter = defaultQueryAdapter,
  ownLifecycle = providedDb === undefined,
}: UseLivingWikiStateViewModelsOptions): UseLivingWikiStateViewModelsResult {
  const ownedDb = useMemo(() => {
    if (providedDb !== undefined || wikiSpaceId === undefined) return undefined
    return createDb({ wikiSpaceId, actorId })
  }, [actorId, createDb, providedDb, wikiSpaceId])

  const db = providedDb ?? ownedDb

  useEffect(() => {
    if (!ownLifecycle || db === undefined) return undefined

    void db.preload()
    return () => {
      void db.close()
    }
  }, [db, ownLifecycle])

  const actors = queryAdapter<ActorRow>(db?.collections.actors)
  const memberships = queryAdapter<MembershipRow>(db?.collections.memberships)
  const activityEvents = queryAdapter<ActivityEventRow>(
    db?.collections.activity_events
  )
  const sources = queryAdapter<SourceRow>(db?.collections.sources)
  const wikiPages = queryAdapter<WikiPageRow>(db?.collections.wiki_pages)
  const wikiLinks = queryAdapter<WikiLinkRow>(db?.collections.wiki_links)
  const reviewItems = queryAdapter<ReviewItemRow>(db?.collections.review_items)

  if (db === undefined) {
    return { viewModel: emptyViewModel, isLoading: false, isError: false }
  }

  return {
    viewModel: {
      activityEvents: selectRecentActivity(activityEvents.data ?? []),
      members: selectMemberCards(memberships.data ?? [], actors.data ?? []),
      sources: selectSourcesByStatus(sources.data ?? []),
      graphSummary: selectWikiGraphSummary(
        wikiPages.data ?? [],
        wikiLinks.data ?? []
      ),
      pageCards: selectWikiPageCards(wikiPages.data ?? []),
      reviewSummary: selectReviewQueueSummary(reviewItems.data ?? []),
    },
    isLoading:
      actors.isLoading === true ||
      memberships.isLoading === true ||
      activityEvents.isLoading === true ||
      sources.isLoading === true ||
      wikiPages.isLoading === true ||
      wikiLinks.isLoading === true ||
      reviewItems.isLoading === true,
    isError:
      actors.isError === true ||
      memberships.isError === true ||
      activityEvents.isError === true ||
      sources.isError === true ||
      wikiPages.isError === true ||
      wikiLinks.isError === true ||
      reviewItems.isError === true,
  }
}
