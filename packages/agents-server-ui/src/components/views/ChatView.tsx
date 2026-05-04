import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CODING_SESSION_ENTITY_TYPE } from '@electric-ax/agents-runtime'
import { useEntityTimeline } from '../../hooks/useEntityTimeline'
import { EntityTimeline } from '../EntityTimeline'
import { MessageInput } from '../MessageInput'
import { EntityContextDrawer } from '../EntityContextDrawer'
import { CodingSessionView } from '../CodingSessionView'
import type { ViewProps } from '../../lib/workspace/viewRegistry'

/**
 * The default view: chat / timeline + message composer.
 *
 * Internally polymorphic on `entity.type`:
 * - `CODING_SESSION_ENTITY_TYPE` → `<CodingSessionView>` (specialised
 *   timeline that pulls events from the coding-session stream).
 * - Anything else → generic timeline driven by `useEntityTimeline`.
 *
 * Both branches share the same `MessageInput` composer at the bottom.
 *
 * The polymorphism is hidden inside this view so the rest of the
 * workspace (registry, menu, tab strip) doesn't need to care about
 * entity sub-types — there's just one user-facing "Chat" view.
 */
export function ChatView({
  baseUrl,
  entityUrl,
  entity,
  entityStopped,
  isSpawning,
}: ViewProps): React.ReactElement {
  // While `spawning`, the entity has no inbox yet — `connectUrl` is null
  // so `useEntityTimeline` doesn't try to subscribe and we render an empty
  // timeline / disabled composer.
  const connectUrl = isSpawning ? null : entityUrl

  if (entity.type === CODING_SESSION_ENTITY_TYPE && connectUrl) {
    return (
      <CodingSessionView
        baseUrl={baseUrl}
        entityUrl={connectUrl}
        entityStopped={entityStopped}
      />
    )
  }

  return (
    <GenericChatBody
      baseUrl={baseUrl}
      entityUrl={connectUrl}
      entity={entity}
      entityStopped={entityStopped}
      isSpawning={isSpawning}
    />
  )
}

function GenericChatBody({
  baseUrl,
  entityUrl,
  entity,
  entityStopped,
  isSpawning,
}: {
  baseUrl: string
  entityUrl: string | null
  entity: ViewProps[`entity`]
  entityStopped: boolean
  isSpawning: boolean
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
