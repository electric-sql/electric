import { useMemo } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  createEntityIncludesQuery,
  getEntityState,
  normalizeEntityTimelineData,
} from './entity-timeline'
import { buildSections } from './use-chat'
import type { EntityStreamDB } from './entity-stream-db'
import type {
  EntityTimelineData,
  EntityTimelineSection,
  EntityTimelineState,
  IncludesEntity,
  IncludesInboxMessage,
  IncludesRun,
  IncludesWakeMessage,
} from './entity-timeline'

export interface UseChatResult {
  sections: Array<EntityTimelineSection>
  state: EntityTimelineState
  runs: Array<IncludesRun>
  inbox: Array<IncludesInboxMessage>
  wakes: Array<IncludesWakeMessage>
  entities: Array<IncludesEntity>
}

const noopQuery = (_q: any): null => null

export function useChat(db: EntityStreamDB | null): UseChatResult {
  const includesQuery = useMemo(
    () => (db ? createEntityIncludesQuery(db) : null),
    [db]
  )

  const { data: timelineRows = [] } = useLiveQuery(includesQuery ?? noopQuery, [
    includesQuery,
  ])
  const timelineData: EntityTimelineData = normalizeEntityTimelineData(
    (timelineRows as Array<EntityTimelineData>)[0] ?? {
      runs: [],
      inbox: [],
      wakes: [],
      contextInserted: [],
      contextRemoved: [],
      entities: [],
    }
  )
  const typedRuns = timelineData.runs
  const typedInbox = timelineData.inbox
  const typedWakes = timelineData.wakes
  const typedEntities = timelineData.entities

  const state = useMemo(
    () => getEntityState(typedRuns, typedInbox),
    [typedRuns, typedInbox]
  )

  const sections = useMemo(
    () => buildSections(typedRuns, typedInbox),
    [typedRuns, typedInbox]
  )

  return {
    sections,
    state,
    runs: typedRuns,
    inbox: typedInbox,
    wakes: typedWakes,
    entities: typedEntities,
  }
}
