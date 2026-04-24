import { useLayoutEffect, useRef } from 'react'
import { Conversation } from './Conversation'
import { PromptInput } from './PromptInput'
import { useCodingSession } from '../hooks/useCodingSession'

const STICKY_BOTTOM_THRESHOLD = 60

interface Props {
  baseUrl: string
  entityUrl: string
}

export function SessionView({ baseUrl, entityUrl }: Props): React.ReactElement {
  const { events, meta, loading, error } = useCodingSession(baseUrl, entityUrl)
  const scrollRef = useRef<HTMLDivElement>(null)
  const didInitialScroll = useRef(false)
  const stickToBottomRef = useRef(true)

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceFromBottom < STICKY_BOTTOM_THRESHOLD
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (events.length === 0) return
    if (!didInitialScroll.current) {
      el.scrollTop = el.scrollHeight
      didInitialScroll.current = true
      stickToBottomRef.current = true
      return
    }
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [events.length])

  let statusLabel: string
  let statusCls: string
  if (loading) {
    statusLabel = `Connecting…`
    statusCls = `snapshot`
  } else if (error) {
    statusLabel = `Disconnected`
    statusCls = `ended`
  } else if (!meta) {
    statusLabel = `Waiting`
    statusCls = `snapshot`
  } else if (meta.status === `error`) {
    statusLabel = `Error`
    statusCls = `ended`
  } else if (meta.status === `running`) {
    statusLabel = `Running`
    statusCls = `live`
  } else if (meta.status === `initializing`) {
    statusLabel = `Initializing`
    statusCls = `snapshot`
  } else {
    statusLabel = `Idle`
    statusCls = `live`
  }

  const promptDisabled = !!error || !meta || meta.status === `error`

  return (
    <section className="embedded-session">
      <div className="embedded-session-header">
        <h2>{meta?.agent ? `${meta.agent} coder` : `Coder`}</h2>
        <span className={`badge ${statusCls}`}>{statusLabel}</span>
        <span className="embedded-session-count">{events.length} events</span>
        {meta?.nativeSessionId && (
          <span
            className="embedded-session-count"
            style={{ fontFamily: `var(--font-mono)` }}
          >
            {meta.nativeSessionId.slice(0, 8)}…
          </span>
        )}
      </div>
      <div
        className="embedded-session-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {loading && (
          <div className="embedded-session-placeholder">Loading session…</div>
        )}
        {error && (
          <div className="embedded-session-placeholder error-state">
            Failed to connect: {error}
          </div>
        )}
        {!loading && !error && <Conversation events={events} embedded />}
      </div>
      {meta?.error && (
        <div className="embedded-session-placeholder error-state">
          Session error: {meta.error}
        </div>
      )}
      <PromptInput
        baseUrl={baseUrl}
        entityUrl={entityUrl}
        disabled={promptDisabled}
      />
    </section>
  )
}
