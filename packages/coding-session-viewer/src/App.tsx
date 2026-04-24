import { useCallback, useEffect, useState } from 'react'
import { SessionView } from './components/SessionView'

interface Target {
  baseUrl: string
  entityUrl: string
}

const SERVER_STORAGE_KEY = `coding-session-viewer-server`

function parseTarget(): Target | null {
  const params = new URLSearchParams(window.location.search)
  const serverParam = params.get(`server`)
  const entityParam = params.get(`entity`)
  const server = serverParam
    ? serverParam
    : window.localStorage.getItem(SERVER_STORAGE_KEY)
  if (!server || !entityParam) return null
  const baseUrl = server.replace(/\/$/, ``)
  const entityUrl = entityParam.startsWith(`/`)
    ? entityParam
    : `/${entityParam}`
  return { baseUrl, entityUrl }
}

function updateQuery(target: Target): void {
  const url = new URL(window.location.href)
  url.searchParams.set(`server`, target.baseUrl)
  url.searchParams.set(`entity`, target.entityUrl)
  window.history.replaceState({}, ``, url.toString())
  window.localStorage.setItem(SERVER_STORAGE_KEY, target.baseUrl)
}

export function App(): React.ReactElement {
  const [target, setTarget] = useState<Target | null>(() => parseTarget())

  useEffect(() => {
    if (target) updateQuery(target)
  }, [target])

  const onConnect = useCallback((t: Target) => {
    setTarget(t)
  }, [])

  if (!target) {
    return <Landing onConnect={onConnect} />
  }

  return (
    <div className="viewer-root">
      <header className="viewer-top">
        <div className="brand">
          <span className="brand-dot"></span>
          <span>Electric Agent Runtime</span>
        </div>
        <div className="viewer-top-right">
          <code
            title="Server"
            style={{ opacity: 0.6, marginRight: 8, fontSize: `0.8rem` }}
          >
            {target.baseUrl}
          </code>
          <code title="Entity" style={{ opacity: 0.8 }}>
            {target.entityUrl}
          </code>
          <button
            type="button"
            className="btn"
            style={{ marginLeft: 12 }}
            onClick={() => setTarget(null)}
          >
            Change
          </button>
        </div>
      </header>
      <main className="viewer-main">
        <SessionView baseUrl={target.baseUrl} entityUrl={target.entityUrl} />
      </main>
    </div>
  )
}

function Landing({
  onConnect,
}: {
  onConnect: (t: Target) => void
}): React.ReactElement {
  const [server, setServer] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return (
      params.get(`server`) ||
      window.localStorage.getItem(SERVER_STORAGE_KEY) ||
      `http://localhost:4437`
    )
  })
  const [entity, setEntity] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get(`entity`) ?? ``
  })

  const canSubmit = server.trim() && entity.trim()

  return (
    <div className="container">
      <div className="brand">
        <span className="brand-dot"></span>
        <span>Electric Agents</span>
      </div>
      <h1>Electric Agent Runtime</h1>
      <p className="lede">
        Point this viewer at an Electric Agents server and a{` `}
        <code>coding-session</code> entity. The browser tab streams normalized
        events from the entity's durable stream and posts prompts to the
        entity's inbox.
      </p>
      <form
        className="token-gate-form"
        style={{
          flexDirection: `column`,
          alignItems: `stretch`,
          maxWidth: 480,
          gap: `0.75rem`,
        }}
        onSubmit={(e) => {
          e.preventDefault()
          if (!canSubmit) return
          onConnect({
            baseUrl: server.trim().replace(/\/$/, ``),
            entityUrl: entity.trim().startsWith(`/`)
              ? entity.trim()
              : `/${entity.trim()}`,
          })
        }}
      >
        <label>
          <div style={{ fontSize: `0.85rem`, marginBottom: 4 }}>
            Agents server URL
          </div>
          <input
            type="text"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="http://localhost:4437"
            aria-label="Agents server URL"
          />
        </label>
        <label>
          <div style={{ fontSize: `0.85rem`, marginBottom: 4 }}>Entity URL</div>
          <input
            type="text"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            placeholder="/coding-session/my-session-id"
            aria-label="Entity URL"
          />
        </label>
        <button type="submit" className="btn primary" disabled={!canSubmit}>
          Connect
        </button>
      </form>
      <p style={{ opacity: 0.55, fontSize: `0.85rem`, marginTop: `1.5rem` }}>
        Tip: the current values are also reflected in the URL — share the link
        as{` `}
        <code>?server=…&amp;entity=…</code> to drop someone directly into a
        session.
      </p>
    </div>
  )
}
