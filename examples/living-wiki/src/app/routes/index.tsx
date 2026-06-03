import { FormEvent, useState } from 'react'
import { createRoute, useNavigate } from '@tanstack/react-router'
import { HealthPanel } from '../components/HealthPanel'
import { useCreateSpace } from '../hooks/useSpace'
import { demoAvatarColors, type DemoAvatarColor } from '../../shared/space'
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
