import { FormEvent, useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import {
  demoAvatarColors,
  type DemoAvatarColor,
  type WikiSpaceSnapshot,
} from '../../shared/space'
import { readDemoSessionIdentity } from '../../shared/session'
import { createLivingWikiApiClient } from '../api/livingWikiApi'
import { IntakeAgentTimeline } from '../components/agents/IntakeAgentTimeline'
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
  const [reviewNote, setReviewNote] = useState(``)
  const [reviewFlowError, setReviewFlowError] = useState<Error | null>(null)
  const [reviewFlowMessage, setReviewFlowMessage] = useState<
    string | undefined
  >()
  const [reviewFlowBusy, setReviewFlowBusy] = useState(false)
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

  async function onProposePage(sourceId: string) {
    if (!displayedSpace) return
    setReviewFlowBusy(true)
    setReviewFlowError(null)
    setReviewFlowMessage(`Proposing page…`)
    try {
      await createLivingWikiApiClient().proposePageFromSource({
        wikiSpaceId,
        actorId: displayedSpace.currentActor.id,
        sourceId,
      })
      setReviewFlowMessage(`Page proposal created.`)
      await refreshSharedState()
    } catch (nextError) {
      setReviewFlowMessage(undefined)
      setReviewFlowError(
        nextError instanceof Error ? nextError : new Error(String(nextError))
      )
    } finally {
      setReviewFlowBusy(false)
    }
  }

  async function onResolveReview(
    reviewItemId: string,
    resolution: `approve` | `reject`
  ) {
    if (!displayedSpace) return
    setReviewFlowBusy(true)
    setReviewFlowError(null)
    setReviewFlowMessage(`Resolving review…`)
    try {
      await createLivingWikiApiClient().resolveReviewItem({
        wikiSpaceId,
        actorId: displayedSpace.currentActor.id,
        reviewItemId,
        resolution,
        note: reviewNote || undefined,
      })
      setReviewFlowMessage(
        resolution === `approve` ? `Review approved.` : `Review rejected.`
      )
      setReviewNote(``)
      await refreshSharedState()
    } catch (nextError) {
      setReviewFlowMessage(undefined)
      setReviewFlowError(
        nextError instanceof Error ? nextError : new Error(String(nextError))
      )
    } finally {
      setReviewFlowBusy(false)
    }
  }

  return (
    <section className="lw-space-frame">
      <header className="lw-space-topbar">
        <div>
          <span className="lw-kicker">Living Wiki:</span>
          {` `}
          <h1 aria-label={displayedSpace?.space.title ?? wikiSpaceId}>
            “{displayedSpace?.space.title ?? wikiSpaceId}”
          </h1>
        </div>
        <nav aria-label="Space actions" className="lw-topbar-actions">
          <button type="button" disabled={displayedSpace === null}>
            + Invite
          </button>
          <button type="button">Layers ▾</button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh wiki space"
          >
            ⚙
          </button>
        </nav>
      </header>

      {loading && displayedSpace === null ? <p>Loading space…</p> : null}
      {error ? <p role="alert">{error.message}</p> : null}
      {displayedSpace ? (
        <div className="lw-presence-strip" aria-label="Space presence">
          <span>{displayedSpace.space.memberCount} members</span>
          <span>Current actor: {displayedSpace.currentActor.displayName}</span>
          <span>Actors:</span>
          {displayedSpace.actors.map((actor) => (
            <span key={actor.id}>{actor.displayName}</span>
          ))}
        </div>
      ) : null}

      {sharedStateError ? (
        <p role="alert">Shared state: {sharedStateError.message}</p>
      ) : null}
      <WikiStateDashboard
        viewModel={sharedStateViewModel}
        onProposePage={(sourceId) => void onProposePage(sourceId)}
        onResolveReview={(reviewItemId, resolution) =>
          void onResolveReview(reviewItemId, resolution)
        }
        actionsDisabled={reviewFlowBusy || displayedSpace === null}
      />
      <div aria-live="polite">
        {reviewFlowMessage ? <p>{reviewFlowMessage}</p> : null}
      </div>
      {reviewFlowError ? <p role="alert">{reviewFlowError.message}</p> : null}

      <section className="lw-review-note-panel">
        <h2>Manual page proposal and review</h2>
        <p>
          Proposals are deterministic templates from submitted source metadata
          only. URL sources are not fetched and no AI generation occurs.
        </p>
        <p>
          Use the <strong>Propose page</strong> buttons on submitted sources and
          the inline review buttons in the dashboard above. No ID copying is
          required.
        </p>
        <label style={{ display: `block`, marginTop: 12 }}>
          Review note
          <input
            aria-label="Review note"
            value={reviewNote}
            onChange={(event) => setReviewNote(event.currentTarget.value)}
          />
        </label>
      </section>

      <IntakeAgentTimeline wikiSpaceId={wikiSpaceId} />

      <form onSubmit={(event) => void onJoin(event)} className="lw-join-panel">
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
