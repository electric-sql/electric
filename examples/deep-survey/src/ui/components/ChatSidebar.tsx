import { useState, useEffect, useMemo, useRef } from 'react'
import {
  createEntityStreamDB,
  createEntityIncludesQuery,
  normalizeEntityTimelineData,
  buildTimelineEntries,
} from '@electric-ax/agents-runtime'
import { useLiveQuery } from '@tanstack/react-db'
import type {
  EntityStreamDB,
  EntityTimelineData,
  EntityTimelineSection,
} from '@electric-ax/agents-runtime'

interface ChatSidebarProps {
  orchestratorUrl: string | null
  darixUrl: string
  onSendMessage: (message: string) => void
}

export function ChatSidebar({
  orchestratorUrl,
  darixUrl,
  onSendMessage,
}: ChatSidebarProps) {
  const [orchDb, setOrchDb] = useState<EntityStreamDB | null>(null)
  const [input, setInput] = useState(``)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!orchestratorUrl || !darixUrl) return
    let cancelled = false

    const streamUrl = `${darixUrl}${orchestratorUrl}/main`
    const db = createEntityStreamDB(streamUrl)
    db.preload()
      .then(() => {
        if (!cancelled) setOrchDb(db)
      })
      .catch((err) => {
        console.error(`Failed to load orchestrator stream:`, err)
      })

    return () => {
      cancelled = true
      db.close()
      setOrchDb(null)
    }
  }, [orchestratorUrl, darixUrl])

  const includesQuery = useMemo(
    () => (orchDb ? createEntityIncludesQuery(orchDb) : null),
    [orchDb]
  )

  const { data: timelineRows = [] } = useLiveQuery(
    (q) => (includesQuery ? includesQuery(q) : undefined),
    [includesQuery]
  )

  const entries = useMemo(() => {
    const td = normalizeEntityTimelineData(
      (timelineRows as Array<EntityTimelineData>)[0] ?? {
        runs: [],
        inbox: [],
        wakes: [],
        entities: [],
      }
    )
    return buildTimelineEntries(td.runs, td.inbox)
  }, [timelineRows])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries.length])

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed || !orchestratorUrl) return
    onSendMessage(trimmed)
    setInput(``)
  }

  return (
    <div
      style={{
        display: `flex`,
        flexDirection: `column`,
        minHeight: 0,
        background: `var(--swarm-bg-panel)`,
        borderRight: `1px solid var(--swarm-border-default)`,
      }}
    >
      <div
        style={{
          padding: `12px 14px`,
          borderBottom: `1px solid var(--swarm-border-subtle)`,
        }}
      >
        <div
          style={{
            fontSize: 9,
            color: `var(--swarm-text-muted)`,
            letterSpacing: 1.2,
            textTransform: `uppercase`,
            marginBottom: 5,
          }}
        >
          orchestrator
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: `var(--swarm-text-primary)`,
            wordBreak: `break-all`,
          }}
        >
          {orchestratorUrl ?? `—`}
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: `auto`,
          padding: `10px 14px`,
          display: `flex`,
          flexDirection: `column`,
          gap: 10,
        }}
      >
        {entries.length === 0 && (
          <div
            style={{
              fontSize: 10,
              color: `var(--swarm-text-muted)`,
              fontStyle: `italic`,
            }}
          >
            waiting for messages…
          </div>
        )}
        {entries.map((entry) => (
          <ChatTurn key={entry.key} section={entry.section} />
        ))}
      </div>

      <div
        style={{
          borderTop: `1px solid var(--swarm-border-default)`,
          padding: `10px 12px`,
          background: `var(--swarm-bg-primary)`,
        }}
      >
        <div
          style={{
            display: `flex`,
            alignItems: `center`,
            gap: 8,
            padding: `8px 10px`,
            background: `rgba(255,255,255,0.04)`,
            border: `1px solid var(--swarm-border-default)`,
          }}
        >
          <span
            style={{
              color: `var(--swarm-accent-orange)`,
              fontSize: 13,
              lineHeight: 1,
            }}
          >
            ›
          </span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === `Enter`) handleSubmit()
            }}
            placeholder="ask follow-up…"
            style={{
              flex: 1,
              background: `transparent`,
              border: `none`,
              color: `var(--swarm-text-primary)`,
              fontFamily: `inherit`,
              fontSize: 11,
              outline: `none`,
              padding: 0,
            }}
          />
          <span
            style={{
              width: 6,
              height: 12,
              background: `var(--swarm-accent-orange)`,
              animation: `swarm-blink 1s steps(2) infinite`,
            }}
          />
        </div>
        <div
          role="button"
          tabIndex={0}
          aria-label="Ask follow-up"
          onClick={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === `Enter` || e.key === ` `) handleSubmit()
          }}
          style={{
            fontSize: 9,
            color: `var(--swarm-text-subtle)`,
            letterSpacing: 0.8,
            marginTop: 6,
            cursor: `pointer`,
          }}
        >
          ↵ ask follow-up
        </div>
      </div>
    </div>
  )
}

function ChatTurn({ section }: { section: EntityTimelineSection }) {
  const isUser = section.kind === `user_message`

  let text = ``
  if (section.kind === `user_message`) {
    text = section.text
  } else {
    text = section.items
      .filter((item) => item.kind === `text`)
      .map((item) => (item as { kind: `text`; text: string }).text)
      .join(`\n`)
    if (section.error) {
      text += `\n[error: ${section.error}]`
    }
  }

  if (!text.trim()) return null

  return (
    <div
      style={{
        display: `flex`,
        flexDirection: `column`,
        alignItems: isUser ? `flex-end` : `flex-start`,
        gap: 3,
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: `var(--swarm-text-subtle)`,
          letterSpacing: 0.8,
          textTransform: `uppercase`,
        }}
      >
        {isUser ? `you` : `orchestrator`}
      </div>
      <div
        style={{
          maxWidth: `92%`,
          padding: `7px 11px`,
          background: isUser
            ? `rgba(217,119,87,0.1)`
            : `rgba(255,255,255,0.04)`,
          border: isUser
            ? `1px solid rgba(217,119,87,0.35)`
            : `1px solid var(--swarm-border-subtle)`,
          fontSize: 11,
          lineHeight: 1.5,
          whiteSpace: `pre-wrap`,
          wordBreak: `break-word`,
        }}
      >
        {text}
      </div>
    </div>
  )
}
