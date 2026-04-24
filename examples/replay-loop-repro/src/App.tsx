import { useState, useEffect, useRef, useCallback } from 'react'
import { ShapeStream, Message } from '@electric-sql/client'

interface LogEntry {
  time: string
  type: `request` | `uptodate` | `suppressed` | `error` | `info` | `cursor`
  message: string
}

// Get saved config from localStorage
const getSavedConfig = () => {
  try {
    const saved = localStorage.getItem(`repro_config`)
    if (saved) return JSON.parse(saved)
  } catch {}
  return {
    url: `https://api.electric-sql.cloud/v1/shape`,
    table: `items`,
    sourceId: ``,
    sourceSecret: ``,
  }
}

// Read Electric's up-to-date tracker from localStorage
const getStoredCursor = () => {
  try {
    const stored = localStorage.getItem(`electric_up_to_date_tracker`)
    if (stored) {
      const data = JSON.parse(stored)
      // Find the first entry and return its cursor
      const entries = Object.entries(data) as [
        string,
        { cursor: string; timestamp: number },
      ][]
      if (entries.length > 0) {
        const [key, entry] = entries[0]
        const age = Math.round((Date.now() - entry.timestamp) / 1000)
        return { key, cursor: entry.cursor, age }
      }
    }
  } catch {}
  return null
}

export default function App() {
  const [config, setConfig] = useState(getSavedConfig)
  const [started, setStarted] = useState(false)
  const [status, setStatus] = useState<
    `idle` | `syncing` | `success` | `stuck`
  >(`idle`)
  const [requestCount, setRequestCount] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [rowCount, setRowCount] = useState(0)
  const [storedCursorInfo, setStoredCursorInfo] = useState(getStoredCursor())
  const [lastResponseCursor, setLastResponseCursor] = useState<string | null>(
    null
  )
  const shapeRef = useRef<ShapeStream | null>(null)
  const requestCountRef = useRef(0)
  const lastRequestTime = useRef(0)
  const rapidRequestCount = useRef(0)

  const addLog = useCallback((type: LogEntry[`type`], message: string) => {
    const time = new Date().toISOString().split(`T`)[1].slice(0, 12)
    setLogs((prev) => [...prev.slice(-100), { time, type, message }])
  }, [])

  const saveConfig = () => {
    localStorage.setItem(`repro_config`, JSON.stringify(config))
    addLog(`info`, `Config saved to localStorage`)
  }

  const startSync = useCallback(() => {
    if (shapeRef.current) return

    setStarted(true)
    setStatus(`syncing`)
    addLog(`info`, `Starting shape sync...`)

    const shape = new ShapeStream({
      url: config.url,
      params: {
        table: config.table,
        ...(config.sourceId && { source_id: config.sourceId }),
        ...(config.sourceSecret && { secret: config.sourceSecret }),
      },
      fetchClient: async (...args) => {
        const now = Date.now()
        requestCountRef.current++
        setRequestCount(requestCountRef.current)

        // Detect rapid requests (potential infinite loop)
        if (now - lastRequestTime.current < 100) {
          rapidRequestCount.current++
          if (rapidRequestCount.current > 10) {
            setStatus(`stuck`)
            addLog(
              `error`,
              `RAPID REQUESTS DETECTED! ${rapidRequestCount.current} requests in quick succession`
            )
          }
        } else {
          rapidRequestCount.current = 0
        }
        lastRequestTime.current = now

        const url = new URL(args[0] as string)
        const offset = url.searchParams.get(`offset`) || `-1`
        const cursor = url.searchParams.get(`cursor`) || `none`
        const live = url.searchParams.get(`live`) || `false`

        addLog(
          `request`,
          `Request #${requestCountRef.current}: offset=${offset}, cursor=${cursor.slice(0, 15)}..., live=${live}`
        )

        const response = await fetch(...args)

        // Capture the response cursor
        let responseCursor = response.headers.get(`electric-cursor`)

        // BUG REPRODUCTION MODE: Inject a fixed cursor into ALL responses
        // This simulates a CDN that caches and returns stale cursor headers
        const injectCursor = localStorage.getItem(`repro_inject_cursor`)
        if (injectCursor) {
          // Clone the response and inject the cursor header
          const body = await response.text()
          const newHeaders = new Headers(response.headers)
          newHeaders.set(`electric-cursor`, injectCursor)
          responseCursor = injectCursor
          addLog(
            `info`,
            `INJECTED cursor: ${injectCursor} (simulating CDN cache)`
          )

          const newResponse = new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          })

          if (responseCursor) {
            setLastResponseCursor(responseCursor)
            const stored = storedCursorInfo
            if (stored) {
              const match = responseCursor === stored.cursor
              addLog(
                `cursor`,
                `Response cursor: ${responseCursor.slice(0, 15)}... | Stored: ${stored.cursor.slice(0, 15)}... | ${match ? `MATCH!` : `different`}`
              )
            } else {
              addLog(
                `cursor`,
                `Response cursor: ${responseCursor.slice(0, 15)}... | No stored cursor`
              )
            }
          }

          return newResponse
        }

        if (responseCursor) {
          setLastResponseCursor(responseCursor)
          const stored = storedCursorInfo
          if (stored) {
            const match = responseCursor === stored.cursor
            addLog(
              `cursor`,
              `Response cursor: ${responseCursor.slice(0, 15)}... | Stored: ${stored.cursor.slice(0, 15)}... | ${match ? `MATCH!` : `different`}`
            )
          } else {
            addLog(
              `cursor`,
              `Response cursor: ${responseCursor.slice(0, 15)}... | No stored cursor`
            )
          }
        }

        return response
      },
    })

    shapeRef.current = shape

    let totalRows = 0

    shape.subscribe((messages: Message[]) => {
      for (const msg of messages) {
        if (`headers` in msg && msg.headers.operation) {
          totalRows++
          setRowCount(totalRows)
        }
        if (`headers` in msg && msg.headers.control === `up-to-date`) {
          if (status !== `stuck`) {
            setStatus(`success`)
          }
          addLog(`uptodate`, `Received up-to-date (${totalRows} rows synced)`)

          // Check localStorage immediately after up-to-date
          setTimeout(() => {
            const stored = localStorage.getItem(`electric_up_to_date_tracker`)
            if (stored) {
              addLog(`info`, `localStorage written: ${stored.slice(0, 100)}...`)
              setStoredCursorInfo(getStoredCursor())
            } else {
              addLog(`error`, `localStorage NOT written after up-to-date!`)
            }
          }, 100)
        }
      }
    })
  }, [config, addLog, status])

  // Auto-start if config exists and page was refreshed
  useEffect(() => {
    const stored = getStoredCursor()
    setStoredCursorInfo(stored)

    if (stored) {
      addLog(
        `info`,
        `Found stored cursor from ${stored.age}s ago: ${stored.cursor.slice(0, 20)}...`
      )
      if (stored.age < 60) {
        addLog(`info`, `REPLAY MODE WILL BE ENTERED (age ${stored.age}s < 60s)`)
      } else {
        addLog(
          `info`,
          `Replay mode will NOT be entered (age ${stored.age}s >= 60s)`
        )
      }
    } else {
      addLog(`info`, `No stored cursor - replay mode will NOT be entered`)
    }

    const autoStart = localStorage.getItem(`repro_autostart`)
    if (autoStart === `true` && config.sourceId) {
      addLog(`info`, `Auto-starting (page was refreshed)`)
      startSync()
    }
  }, [])

  const handleStart = () => {
    saveConfig()
    localStorage.setItem(`repro_autostart`, `true`)
    startSync()
  }

  const clearLocalStorage = () => {
    // Clear Electric's localStorage entries
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (key.startsWith(`electric_`) || key === `repro_autostart`)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key))
    addLog(
      `info`,
      `Cleared ${keysToRemove.length} Electric localStorage entries`
    )
    window.location.reload()
  }

  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div>
      <h1>Replay Mode Infinite Loop Bug Repro</h1>

      {!started ? (
        <>
          <div className="instructions">
            <h3>Instructions (Bug Reproduction Mode)</h3>
            <ol>
              <li>Enter your Electric Cloud connection details below</li>
              <li>Click "Start Sync" - note the cursor value in the logs</li>
              <li>
                Click "Enable Bug Repro Mode" - this will inject a fixed cursor
                into ALL responses
              </li>
              <li>
                <strong>Refresh the page</strong>
              </li>
              <li>
                If the bug triggers, you'll see the request counter spike and
                status turn red
              </li>
            </ol>
            <p style={{ marginTop: `10px`, color: `#fbbf24` }}>
              <strong>Why this is needed:</strong> In production, only live
              responses have cursor headers. Initial sync responses don't, so
              the bug can't trigger normally. This mode simulates a CDN that
              incorrectly serves cached live responses for all requests.
            </p>
          </div>

          <div className="config">
            <h3>Configuration</h3>
            <label>
              Electric URL:
              <input
                value={config.url}
                onChange={(e) => setConfig({ ...config, url: e.target.value })}
                placeholder="https://api.electric-sql.cloud/v1/shape"
              />
            </label>
            <label>
              Table name:
              <input
                value={config.table}
                onChange={(e) =>
                  setConfig({ ...config, table: e.target.value })
                }
                placeholder="items"
              />
            </label>
            <label>
              Source ID:
              <input
                value={config.sourceId}
                onChange={(e) =>
                  setConfig({ ...config, sourceId: e.target.value })
                }
                placeholder="your-source-id"
              />
            </label>
            <label>
              Source Secret:
              <input
                type="password"
                value={config.sourceSecret}
                onChange={(e) =>
                  setConfig({ ...config, sourceSecret: e.target.value })
                }
                placeholder="your-source-secret"
              />
            </label>
            <button onClick={handleStart}>Start Sync</button>
          </div>
        </>
      ) : (
        <>
          <div className={`status ${status}`}>
            {status === `syncing` && `🔄 Syncing...`}
            {status === `success` && `✅ Synced Successfully`}
            {status === `stuck` && `🔴 INFINITE LOOP DETECTED!`}
          </div>

          <div style={{ display: `flex`, gap: `40px`, marginBottom: `20px` }}>
            <div>
              <div style={{ color: `#888`, fontSize: `14px` }}>
                HTTP Requests
              </div>
              <div className="counter">{requestCount}</div>
            </div>
            <div>
              <div style={{ color: `#888`, fontSize: `14px` }}>Rows Synced</div>
              <div className="counter">{rowCount}</div>
            </div>
          </div>

          <div
            style={{
              background: `#333`,
              padding: `15px`,
              borderRadius: `8px`,
              marginBottom: `20px`,
              fontFamily: `monospace`,
              fontSize: `12px`,
            }}
          >
            <div
              style={{
                marginBottom: `10px`,
                fontWeight: `bold`,
                color: `#ffd700`,
              }}
            >
              Debug Info (Replay Mode)
            </div>
            <div>
              <strong>Stored cursor:</strong>
              {` `}
              {storedCursorInfo ? (
                <span
                  style={{
                    color: storedCursorInfo.age < 60 ? `#f87171` : `#34d399`,
                  }}
                >
                  {storedCursorInfo.cursor.slice(0, 20)}... (
                  {storedCursorInfo.age}s ago)
                  {storedCursorInfo.age < 60
                    ? ` - WILL ENTER REPLAY MODE`
                    : ` - expired`}
                </span>
              ) : (
                <span style={{ color: `#888` }}>none</span>
              )}
            </div>
            <div>
              <strong>Last response cursor:</strong>
              {` `}
              {lastResponseCursor ? (
                <span>{lastResponseCursor.slice(0, 20)}...</span>
              ) : (
                <span style={{ color: `#888` }}>none yet</span>
              )}
            </div>
            <div>
              <strong>Cursors match:</strong>
              {` `}
              {storedCursorInfo && lastResponseCursor ? (
                storedCursorInfo.cursor === lastResponseCursor ? (
                  <span style={{ color: `#f87171`, fontWeight: `bold` }}>
                    YES - BUG SHOULD TRIGGER!
                  </span>
                ) : (
                  <span style={{ color: `#34d399` }}>No - loop will break</span>
                )
              ) : (
                <span style={{ color: `#888` }}>n/a</span>
              )}
            </div>
          </div>

          <div
            style={{
              marginBottom: `20px`,
              display: `flex`,
              gap: `10px`,
              flexWrap: `wrap`,
            }}
          >
            <button
              onClick={clearLocalStorage}
              style={{ background: `#dc2626` }}
            >
              Clear Electric localStorage & Reload
            </button>
            <button
              onClick={() => {
                const stored = localStorage.getItem(
                  `electric_up_to_date_tracker`
                )
                addLog(`info`, `Raw localStorage: ${stored || `null`}`)
                setStoredCursorInfo(getStoredCursor())
              }}
              style={{ background: `#2563eb` }}
            >
              Check localStorage Now
            </button>
            <button
              onClick={() => {
                const allKeys: string[] = []
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i)
                  if (key) allKeys.push(key)
                }
                addLog(`info`, `All localStorage keys: ${allKeys.join(`, `)}`)
              }}
              style={{ background: `#7c3aed` }}
            >
              List All Keys
            </button>
          </div>

          <div
            style={{
              background: `#7f1d1d`,
              padding: `15px`,
              borderRadius: `8px`,
              marginBottom: `20px`,
            }}
          >
            <div
              style={{
                fontWeight: `bold`,
                marginBottom: `10px`,
                color: `#fca5a5`,
              }}
            >
              Bug Reproduction Mode
            </div>
            <div
              style={{
                marginBottom: `10px`,
                fontSize: `12px`,
                color: `#fecaca`,
              }}
            >
              Injects a fixed cursor header into ALL responses to simulate a
              misbehaving CDN. Set the cursor to match what's in localStorage,
              then refresh to trigger the bug.
            </div>
            <div
              style={{
                display: `flex`,
                gap: `10px`,
                alignItems: `center`,
                flexWrap: `wrap`,
              }}
            >
              <button
                onClick={() => {
                  const stored = getStoredCursor()
                  if (stored && stored.cursor) {
                    localStorage.setItem(`repro_inject_cursor`, stored.cursor)
                    addLog(
                      `error`,
                      `BUG REPRO MODE ENABLED: Will inject cursor "${stored.cursor}" into all responses`
                    )
                    addLog(`error`, `Now REFRESH THE PAGE to trigger the bug!`)
                  } else {
                    addLog(
                      `error`,
                      `No stored cursor found. Complete a sync first, wait 60s, then try again.`
                    )
                  }
                }}
                style={{ background: `#b91c1c` }}
              >
                Enable Bug Repro Mode (use stored cursor)
              </button>
              <button
                onClick={() => {
                  if (lastResponseCursor) {
                    localStorage.setItem(
                      `repro_inject_cursor`,
                      lastResponseCursor
                    )
                    addLog(
                      `error`,
                      `BUG REPRO MODE ENABLED: Will inject cursor "${lastResponseCursor}" into all responses`
                    )
                    addLog(`error`, `Now REFRESH THE PAGE to trigger the bug!`)
                  } else {
                    addLog(
                      `error`,
                      `No response cursor seen yet. Complete a sync first.`
                    )
                  }
                }}
                style={{ background: `#b91c1c` }}
              >
                Enable Bug Repro Mode (use last response cursor)
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem(`repro_inject_cursor`)
                  addLog(`info`, `Bug repro mode disabled`)
                }}
                style={{ background: `#475569` }}
              >
                Disable Bug Repro Mode
              </button>
            </div>
            <div
              style={{ marginTop: `10px`, fontSize: `11px`, color: `#fca5a5` }}
            >
              Current inject cursor:{` `}
              {localStorage.getItem(`repro_inject_cursor`) || `none (disabled)`}
            </div>
          </div>

          <h3>Request Log</h3>
          <div className="log" ref={logRef}>
            {logs.map((log, i) => (
              <div key={i} className={`log-entry ${log.type}`}>
                [{log.time}] {log.message}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
