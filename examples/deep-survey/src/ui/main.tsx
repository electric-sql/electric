import { StrictMode, useState, useCallback, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useSwarm } from './hooks/useSwarm'
import { SwarmView } from './components/SwarmView'
import './swarm-theme.css'

function App() {
  const [config, setConfig] = useState<{ darixUrl: string } | null>(null)
  const [swarm, setSwarm] = useState<{
    name: string
    orchestratorUrl: string
  } | null>(null)
  const [inputValue, setInputValue] = useState(``)
  const [starting, setStarting] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/config`)
      .then((r) => {
        if (!r.ok) throw new Error(`Config endpoint returned ${r.status}`)
        return r.json()
      })
      .then((c) => setConfig(c as { darixUrl: string }))
      .catch((err) => {
        console.error(`Failed to load config:`, err)
        setLaunchError(
          `Failed to connect: ${err instanceof Error ? err.message : String(err)}`
        )
      })
  }, [])

  const { agents, wiki, xrefs, connected } = useSwarm(
    config?.darixUrl ?? null,
    swarm?.name ?? null
  )

  const startSwarm = useCallback(async (message: string) => {
    setStarting(true)
    setLaunchError(null)
    try {
      const res = await fetch(`/api/swarm`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({ message: message || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`
        )
      }
      const data = (await res.json()) as {
        name: string
        orchestratorUrl: string
      }
      setSwarm(data)
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }, [])

  const [sendError, setSendError] = useState<string | null>(null)

  const sendFollowUp = useCallback(
    async (message: string) => {
      if (!config || !swarm) return
      setSendError(null)
      try {
        const res = await fetch(
          `${config.darixUrl}${swarm.orchestratorUrl}/send`,
          {
            method: `POST`,
            headers: { 'Content-Type': `application/json` },
            body: JSON.stringify({ from: `user`, payload: message }),
          }
        )
        if (!res.ok) {
          setSendError(`Send failed: HTTP ${res.status}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Failed to send message`, err)
        setSendError(`Send failed: ${msg}`)
      }
    },
    [config, swarm]
  )

  if (!config) {
    return (
      <div
        className="swarm-root"
        style={{
          height: `100vh`,
          display: `flex`,
          alignItems: `center`,
          justifyContent: `center`,
        }}
      >
        connecting to darix…
      </div>
    )
  }

  if (!swarm) {
    return (
      <div
        className="swarm-root"
        style={{
          height: `100vh`,
          display: `flex`,
          flexDirection: `column`,
          alignItems: `center`,
          justifyContent: `center`,
          gap: 16,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: 1 }}>
          DARIX DEEP SURVEY
        </div>
        <div style={{ color: `var(--swarm-text-muted)`, fontSize: 10 }}>
          Enter a topic or corpus to deep-survey
        </div>
        <div style={{ display: `flex`, gap: 8, width: 500 }}>
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === `Enter` && !starting) startSwarm(inputValue)
            }}
            placeholder="e.g., Explore the React source code, Survey honeyberry cultivation"
            style={{
              flex: 1,
              padding: `8px 12px`,
              background: `rgba(255,255,255,0.04)`,
              border: `1px solid var(--swarm-border-default)`,
              color: `var(--swarm-text-primary)`,
              fontFamily: `var(--swarm-font)`,
              fontSize: 11,
              outline: `none`,
            }}
          />
          <button
            onClick={() => startSwarm(inputValue)}
            disabled={starting}
            style={{
              padding: `8px 16px`,
              background: `var(--swarm-accent-orange)`,
              color: `#fff`,
              border: `none`,
              fontFamily: `var(--swarm-font)`,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 1,
              textTransform: `uppercase`,
              cursor: starting ? `wait` : `pointer`,
              opacity: starting ? 0.6 : 1,
            }}
          >
            {starting ? `spawning…` : `explore`}
          </button>
        </div>
        {launchError && (
          <div style={{ color: `var(--swarm-accent-red)`, fontSize: 10 }}>
            {launchError}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <SwarmView
        agents={agents}
        wiki={wiki}
        xrefs={xrefs}
        connected={connected}
        darixUrl={config.darixUrl}
        swarmId={swarm.name}
        orchestratorUrl={swarm.orchestratorUrl}
        onSendMessage={sendFollowUp}
      />
      {sendError && (
        <div
          className="swarm-root"
          style={{
            position: `fixed`,
            bottom: 16,
            left: `50%`,
            transform: `translateX(-50%)`,
            background: `rgba(239,68,68,0.15)`,
            border: `1px solid var(--swarm-accent-red)`,
            color: `var(--swarm-accent-red)`,
            padding: `6px 14px`,
            fontSize: 10,
            zIndex: 100,
          }}
        >
          {sendError}
        </div>
      )}
    </>
  )
}

createRoot(document.getElementById(`root`)!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
