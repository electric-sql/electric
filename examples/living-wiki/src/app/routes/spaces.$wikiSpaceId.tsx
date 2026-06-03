import { FormEvent, useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import {
  demoAvatarColors,
  type DemoAvatarColor,
  type WikiSpaceSnapshot,
} from '../../shared/space'
import { readDemoSessionIdentity } from '../../shared/session'
import { createLivingWikiApiClient } from '../api/livingWikiApi'
import { WikiStateDashboard } from '../components/wiki-state/WikiStateDashboard'
import { useLivingWikiStateSnapshot } from '../hooks/useLivingWikiStateSnapshot'
import { useJoinSpace, useSpace } from '../hooks/useSpace'
import { Route as rootRoute } from './__root'

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: `/spaces/$wikiSpaceId`,
  component: SpaceRoute,
})

const readStoredActorId = (): string | undefined => {
  if (typeof window === `undefined`) {
    return undefined
  }

  try {
    return readDemoSessionIdentity(window.localStorage).actorId
  } catch {
    return undefined
  }
}

function SpaceRoute() {
  const { wikiSpaceId } = Route.useParams()
  return <SpaceRoutePage wikiSpaceId={wikiSpaceId} />
}

const isDemoAvatarColor = (value: string): value is DemoAvatarColor =>
  demoAvatarColors.some((color) => color === value)

export function SpaceRoutePage({ wikiSpaceId }: { wikiSpaceId: string }) {
  const [storedActorId, setStoredActorId] = useState(readStoredActorId)
  const [displayName, setDisplayName] = useState(``)
  const [avatarColor, setAvatarColor] = useState<DemoAvatarColor>(`blue`)
  const [joinedSpace, setJoinedSpace] = useState<WikiSpaceSnapshot | null>(null)
  const [sourceKind, setSourceKind] = useState<`text` | `url`>(`text`)
  const [sourceTitle, setSourceTitle] = useState(``)
  const [sourceBody, setSourceBody] = useState(``)
  const [sourceUrl, setSourceUrl] = useState(``)
  const [sourceError, setSourceError] = useState<Error | null>(null)
  const [submittingSource, setSubmittingSource] = useState(false)
  const { space, loading, error, refresh } = useSpace(
    wikiSpaceId,
    storedActorId
  )
  const join = useJoinSpace(wikiSpaceId)
  const displayedSpace = joinedSpace ?? space
  const {
    viewModel: sharedStateViewModel,
    refresh: refreshSharedState,
    error: sharedStateError,
  } = useLivingWikiStateSnapshot({ wikiSpaceId })

  async function onJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const snapshot = await join.joinSpace({ displayName, avatarColor })
    setJoinedSpace(snapshot)
    setStoredActorId(snapshot.currentActor.id)
    setDisplayName(``)
    await refreshSharedState()
  }

  async function onSubmitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!displayedSpace) return

    setSubmittingSource(true)
    setSourceError(null)
    try {
      await createLivingWikiApiClient().submitSource(
        sourceKind === `text`
          ? {
              wikiSpaceId,
              actorId: displayedSpace.currentActor.id,
              kind: `text`,
              title: sourceTitle,
              body: sourceBody,
            }
          : {
              wikiSpaceId,
              actorId: displayedSpace.currentActor.id,
              kind: `url`,
              title: sourceTitle,
              url: sourceUrl,
            }
      )
      setSourceTitle(``)
      setSourceBody(``)
      setSourceUrl(``)
      await refreshSharedState()
    } catch (nextError) {
      setSourceError(
        nextError instanceof Error ? nextError : new Error(String(nextError))
      )
    } finally {
      setSubmittingSource(false)
    }
  }

  return (
    <section className="lw-card" style={{ padding: 32 }}>
      <p style={{ color: `var(--lw-muted)`, fontWeight: 700 }}>Wiki space</p>
      {loading && displayedSpace === null ? <p>Loading space…</p> : null}
      {error ? <p role="alert">{error.message}</p> : null}
      {displayedSpace ? (
        <>
          <h1>{displayedSpace.space.title}</h1>
          <p>{displayedSpace.space.memberCount} members</p>
          <p>Current actor: {displayedSpace.currentActor.displayName}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            Refresh
          </button>
          <h2>Actors</h2>
          <ul>
            {displayedSpace.actors.map((actor) => (
              <li key={actor.id}>
                <strong>{actor.displayName}</strong>
                {` `}
                <span>({actor.avatarColor})</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {sharedStateError ? (
        <p role="alert">Shared state: {sharedStateError.message}</p>
      ) : null}
      <WikiStateDashboard viewModel={sharedStateViewModel} />

      <form
        onSubmit={(event) => void onSubmitSource(event)}
        style={{ marginTop: 24 }}
      >
        <h2>Submit a source</h2>
        <label>
          Source type
          <select
            aria-label="Source type"
            value={sourceKind}
            onChange={(event) =>
              setSourceKind(
                event.currentTarget.value === `url` ? `url` : `text`
              )
            }
          >
            <option value="text">Text note</option>
            <option value="url">URL</option>
          </select>
        </label>
        <label style={{ display: `block`, marginTop: 12 }}>
          Source title
          <input
            aria-label="Source title"
            required
            value={sourceTitle}
            onChange={(event) => setSourceTitle(event.currentTarget.value)}
          />
        </label>
        {sourceKind === `text` ? (
          <label style={{ display: `block`, marginTop: 12 }}>
            Source text
            <textarea
              aria-label="Source text"
              required
              value={sourceBody}
              onChange={(event) => setSourceBody(event.currentTarget.value)}
            />
          </label>
        ) : (
          <label style={{ display: `block`, marginTop: 12 }}>
            Source URL
            <input
              aria-label="Source URL"
              required
              type="url"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.currentTarget.value)}
            />
          </label>
        )}
        <button
          type="submit"
          disabled={submittingSource || displayedSpace === null}
          style={{ marginTop: 12 }}
        >
          Submit source
        </button>
        {sourceError ? <p role="alert">{sourceError.message}</p> : null}
      </form>

      <form onSubmit={(event) => void onJoin(event)} style={{ marginTop: 24 }}>
        <h2>Join this space</h2>
        <label>
          Display name
          <input
            aria-label="Display name"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
          />
        </label>
        <label style={{ display: `block`, marginTop: 12 }}>
          Avatar color
          <select
            aria-label="Avatar color"
            value={avatarColor}
            onChange={(event) => {
              if (isDemoAvatarColor(event.currentTarget.value)) {
                setAvatarColor(event.currentTarget.value)
              }
            }}
          >
            {demoAvatarColors.map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={join.loading} style={{ marginTop: 12 }}>
          Join space
        </button>
        {join.error ? <p role="alert">{join.error.message}</p> : null}
      </form>
    </section>
  )
}
