import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useEntityTimeline } from '../../hooks/useEntityTimeline'
import { EntityTimeline } from '../EntityTimeline'
import { MessageInput } from '../MessageInput'
import { EntityContextDrawer } from '../EntityContextDrawer'
import type { ViewProps } from '../../lib/workspace/viewRegistry'

/**
 * The default view: chat / timeline + message composer.
 *
 * Drives a generic timeline via `useEntityTimeline` for every entity
 * type — keeping this view sub-type-agnostic means the rest of the
 * workspace (registry, menu, tab strip) doesn't need to care about
 * entity sub-types either.
 */
export function ChatView({
  baseUrl,
  entityUrl,
  entity,
  entityStopped,
  isSpawning,
  tileId,
}: ViewProps): React.ReactElement {
  // While `spawning`, the entity has no inbox yet — `connectUrl` is null
  // so `useEntityTimeline` doesn't try to subscribe and we render an empty
  // timeline / disabled composer.
  const connectUrl = isSpawning ? null : entityUrl

  return (
    <GenericChatBody
      baseUrl={baseUrl}
      entityUrl={connectUrl}
      entity={entity}
      entityStopped={entityStopped}
      isSpawning={isSpawning}
      tileId={tileId}
    />
  )
}

function GenericChatBody({
  baseUrl,
  entityUrl,
  entity,
  entityStopped,
  isSpawning,
  tileId,
}: {
  baseUrl: string
  entityUrl: string | null
  entity: ViewProps[`entity`]
  entityStopped: boolean
  isSpawning: boolean
  tileId: string
}): React.ReactElement {
  const { entries, db, loading, error } = useEntityTimeline(
    baseUrl || null,
    entityUrl
  )
  const navigate = useNavigate()

  // If the timeline subscription errors out for an entity that isn't
  // currently spawning (so the failure isn't transient), bounce back to
  // the new-session screen — same behaviour as the previous in-route
  // implementation.
  useEffect(() => {
    if (error && !isSpawning) {
      void navigate({ to: `/` })
    }
  }, [error, navigate, isSpawning])

  return (
    <>
      <EntityTimeline
        entries={entries}
        loading={loading}
        error={error}
        entityStopped={entityStopped}
        cacheKey={`${baseUrl}${entityUrl ?? ``}`}
        tileId={tileId}
      />
      <MessageInput
        db={db}
        baseUrl={baseUrl}
        entityUrl={entityUrl ?? ``}
        disabled={entityStopped || !db}
        drawer={<EntityContextDrawer entity={entity} />}
      />
    </>
  )
}
