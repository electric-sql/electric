import { FormEvent, useEffect, useState } from 'react'
import { createRoute, useNavigate } from '@tanstack/react-router'
import { HealthPanel } from '../components/HealthPanel'
import { createLivingWikiApiClient } from '../api/livingWikiApi'
import { useCreateSpace } from '../hooks/useSpace'
import { demoAvatarColors, type DemoAvatarColor } from '../../shared/space'
import type { HealthResponse } from '../../shared/types'
import { writeDemoSessionIdentity } from '../../shared/session'
import { Route as rootRoute } from './__root'

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: `/`,
  component: IndexRoute,
})

const isDemoAvatarColor = (value: string): value is DemoAvatarColor =>
  demoAvatarColors.some((color) => color === value)

function IndexRoute() {
  const navigate = useNavigate({ from: `/` })
  const create = useCreateSpace()
  const [title, setTitle] = useState(``)
  const [displayName, setDisplayName] = useState(``)
  const [avatarColor, setAvatarColor] = useState<DemoAvatarColor>(`blue`)
  const [seededDemoEnabled, setSeededDemoEnabled] = useState(false)
  const [seedLoading, setSeedLoading] = useState(false)
  const [seedError, setSeedError] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    fetch(`/api/health`)
      .then((response) => response.json() as Promise<HealthResponse>)
      .then((health) => {
        if (!cancelled && health.ok)
          setSeededDemoEnabled(health.seededDemoEnabled)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const snapshot = await create.createSpace({
      title,
      displayName,
      avatarColor,
    })
    await navigate({
      to: `/spaces/$wikiSpaceId`,
      params: { wikiSpaceId: snapshot.space.id },
    })
  }

  async function onStartSeededDemo() {
    setSeedLoading(true)
    setSeedError(undefined)
    try {
      const result = await createLivingWikiApiClient().startSeededDemo()
      writeDemoSessionIdentity(window.localStorage, {
        actorId: result.space.currentActor.id,
        displayName: result.space.currentActor.displayName,
        avatarColor: result.space.currentActor.avatarColor,
      })
      await navigate({
        to: `/spaces/$wikiSpaceId`,
        params: { wikiSpaceId: result.space.space.id },
      })
    } catch (error) {
      setSeedError(error instanceof Error ? error.message : `Seed failed`)
    } finally {
      setSeedLoading(false)
    }
  }

  return (
    <section className="lw-card" style={{ padding: 32 }}>
      <p
        style={{
          color: `var(--lw-muted)`,
          fontWeight: 700,
          letterSpacing: `0.08em`,
          textTransform: `uppercase`,
        }}
      >
        Electric Agents Demo
      </p>
      <h1 style={{ fontSize: 56, lineHeight: 1, margin: `12px 0 16px` }}>
        Living Wiki
      </h1>
      <p
        style={{
          color: `var(--lw-muted)`,
          fontSize: 20,
          lineHeight: 1.5,
          maxWidth: 760,
        }}
      >
        A multiplayer substrate-engineering demo where humans and agents compile
        sources into a living wiki graph.
      </p>

      {seededDemoEnabled ? (
        <div style={{ margin: `24px 0` }}>
          <button
            type="button"
            disabled={seedLoading}
            onClick={() => void onStartSeededDemo()}
          >
            Start seeded demo
          </button>
          {seedError ? <p role="alert">{seedError}</p> : null}
        </div>
      ) : null}

      <form
        onSubmit={(event) => void onCreate(event)}
        style={{ margin: `24px 0` }}
      >
        <h2>Create a wiki space</h2>
        <label>
          Space title
          <input
            aria-label="Space title"
            required
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <label style={{ display: `block`, marginTop: 12 }}>
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
        <button
          type="submit"
          disabled={create.loading}
          style={{ marginTop: 12 }}
        >
          Create space
        </button>
        {create.error ? <p role="alert">{create.error.message}</p> : null}
      </form>

      <HealthPanel />
    </section>
  )
}
