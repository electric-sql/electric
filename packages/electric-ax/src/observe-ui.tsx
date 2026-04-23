import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Newline, Text, render, useInput } from 'ink'
import { useLiveQuery } from '@tanstack/react-db'
import { createOptimisticAction } from '@durable-streams/state'
import {
  buildSections,
  createEntityIncludesQuery,
  normalizeEntityTimelineData,
} from '@electric-ax/agent-runtime'
import { createEntityStreamDB } from './entity-stream-db'
import type {
  EntityStopped,
  EntityTimelineContentItem,
  EntityTimelineData,
  EntityTimelineSection,
  MessageReceived,
} from '@electric-ax/agent-runtime'
import type { EntityStreamDB } from './entity-stream-db'

interface StreamingText {
  key: string
  status: `streaming` | `completed`
}

// ============================================================================
// Helpers
// ============================================================================

export function formatTime(iso: string | undefined): string {
  if (!iso) return ``
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], {
      hour: `2-digit`,
      minute: `2-digit`,
      second: `2-digit`,
    })
  } catch {
    return ``
  }
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + `...` : s
}

// ============================================================================
// Ink components
// ============================================================================

export function UserMessageView({
  msg,
}: {
  msg: MessageReceived
}): React.ReactElement {
  const time = formatTime(msg.timestamp)
  const payload = msg.payload
  let text = ``
  if (typeof payload === `string`) {
    text = payload
  } else if (typeof payload === `object` && payload !== null) {
    const p = payload as Record<string, unknown>
    text = typeof p.text === `string` ? p.text : JSON.stringify(payload)
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text bold color="cyan">{`┌ ${msg.from}`}</Text>
        {time ? <Text dimColor>{`  ${time}`}</Text> : null}
      </Text>
      {text.split(`\n`).map((line, i) => (
        <Text key={i} color="white">
          {`│ ${line}`}
        </Text>
      ))}
    </Box>
  )
}

export function AgentTextView({
  text,
  accumulatedText,
  label,
}: {
  text: StreamingText
  accumulatedText: string
  label?: string
}): React.ReactElement {
  const lines = accumulatedText.split(`\n`)
  const cursor = text.status !== `completed` ? ` ▌` : ``

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text bold color="green">{`┌ ${label ?? `assistant`}`}</Text>
      </Text>
      {lines.map((line, i) => (
        <Text key={i} color="white">
          {`│ ${line}${i === lines.length - 1 ? cursor : ``}`}
        </Text>
      ))}
    </Box>
  )
}

export function ToolCallView({
  tc,
}: {
  tc: Extract<EntityTimelineContentItem, { kind: `tool_call` }>
}): React.ReactElement {
  let statusIcon: string
  let statusColor: string
  if (tc.status === `started`) {
    statusIcon = `○`
    statusColor = `yellow`
  } else if (tc.isError) {
    statusIcon = `✗`
    statusColor = `red`
  } else if (tc.result !== undefined) {
    statusIcon = `✓`
    statusColor = `green`
  } else {
    statusIcon = `⟳`
    statusColor = `yellow`
  }
  const resultStr = tc.result

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={statusColor}>{`  ${statusIcon} `}</Text>
        <Text bold dimColor>
          {tc.toolName}
        </Text>
      </Text>
      {resultStr !== undefined && !tc.isError ? (
        <ToolResultView result={resultStr} />
      ) : null}
      {resultStr !== undefined && tc.isError ? (
        <Text color="red">{`    ↳ ${truncate(resultStr, 120)}`}</Text>
      ) : null}
    </Box>
  )
}

export function ToolResultView({
  result,
}: {
  result: string
}): React.ReactElement {
  const lines = result.split(`\n`)
  const maxLines = 5
  const shown = lines.slice(0, maxLines)
  const remaining = lines.length - maxLines

  return (
    <Box flexDirection="column">
      {shown.map((line, i) => (
        <Text key={i} dimColor>
          {`    │ ${truncate(line, 100)}`}
        </Text>
      ))}
      {remaining > 0 ? (
        <Text dimColor>{`    │ ... ${remaining} more lines`}</Text>
      ) : null}
    </Box>
  )
}

// ============================================================================
// Message input
// ============================================================================

export function MessageInput({
  db,
  baseUrl,
  entityUrl,
  identity,
  disabled,
}: {
  db: EntityStreamDB
  baseUrl: string
  entityUrl: string
  identity: string
  disabled: boolean
}): React.ReactElement {
  const [value, setValue] = useState(``)
  const [error, setError] = useState<string | null>(null)

  const sendAction = useMemo(
    () =>
      createOptimisticAction<{ text: string }>({
        onMutate: ({ text }) => {
          db.collections.inbox.insert({
            key: `optimistic-${Date.now()}`,
            from: identity,
            payload: { text },
            timestamp: new Date().toISOString(),
          } as any)
        },
        mutationFn: async ({ text }) => {
          const res = await fetch(`${baseUrl}${entityUrl}/send`, {
            method: `POST`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify({ from: identity, payload: { text } }),
          })
          if (!res.ok) {
            const body = await res.text().catch(() => ``)
            let message = `Send failed (${res.status})`
            if (body) {
              try {
                const data = JSON.parse(body) as Record<string, unknown>
                if (data.message) {
                  message = String(data.message)
                } else {
                  message = body
                }
              } catch (err) {
                if (err instanceof SyntaxError) {
                  message = body
                } else {
                  throw err
                }
              }
            }
            throw new Error(message)
          }
        },
      }),
    [db, baseUrl, entityUrl, identity]
  )

  useInput(
    (input, key) => {
      if (disabled) return

      if (key.return) {
        if (value.trim()) {
          setError(null)
          const tx = sendAction({ text: value.trim() })
          setValue(``)
          tx.isPersisted.promise.catch((err: Error) => {
            setError(err.message)
          })
        }
        return
      }

      if (key.backspace || key.delete) {
        setValue((prev) => prev.slice(0, -1))
        return
      }

      if (input && !key.ctrl && !key.meta) {
        setValue((prev) => prev + input)
      }
    },
    { isActive: !disabled }
  )

  if (disabled) return <></>

  return (
    <Box flexDirection="column" marginTop={1}>
      {error ? <Text color="red">{`  ${error}`}</Text> : null}
      <Box>
        <Text color="cyan" bold>{`> `}</Text>
        <Text>{value}</Text>
        <Text dimColor>{`▌`}</Text>
      </Box>
    </Box>
  )
}

function AgentResponseView({
  section,
  label,
  isStreaming,
}: {
  section: Extract<EntityTimelineSection, { kind: `agent_response` }>
  label: string
  isStreaming: boolean
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {section.items.map((item, i) => {
        if (item.kind === `text`) {
          return (
            <AgentTextView
              key={`${label}-text-${i}`}
              text={{
                key: `${label}-text-${i}`,
                status: isStreaming ? `streaming` : `completed`,
              }}
              accumulatedText={item.text}
              label={label}
            />
          )
        }

        return <ToolCallView key={item.toolCallId} tc={item} />
      })}

      {section.done ? (
        <Box marginTop={1}>
          <Text color="green">{`✓ complete`}</Text>
        </Box>
      ) : null}

      {section.error ? (
        <Box marginTop={1}>
          <Text color="red">{`✗ ${section.error}`}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

// ============================================================================
// Main observe component — reads from StreamDB collections
// ============================================================================

function ObserveView({
  db,
  entityUrl,
  baseUrl,
  identity,
}: {
  db: EntityStreamDB
  entityUrl: string
  baseUrl: string
  identity: string
}): React.ReactElement {
  const timelineQuery = useMemo(
    () => createEntityIncludesQuery(db as any),
    [db]
  )

  const { data: timelineRows = [] } = useLiveQuery(timelineQuery as any, [
    timelineQuery,
  ])
  const timelineData = normalizeEntityTimelineData(
    (timelineRows as Array<EntityTimelineData>)[0] ?? {
      runs: [],
      inbox: [],
      wakes: [],
      entities: [],
    }
  )

  const typedRuns = timelineData.runs
  const typedInbox = timelineData.inbox

  const timeline = useMemo(
    () => buildSections(typedRuns, typedInbox),
    [typedRuns, typedInbox]
  )

  const { data: stopped = [] } = useLiveQuery(
    (q: any) => q.from({ entityStopped: db.collections.entityStopped as any }),
    [db]
  )

  const closed = (stopped as Array<EntityStopped>).length > 0

  const lastAgentIndex = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i]!.kind === `agent_response`) return i
    }
    return -1
  }, [timeline])

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text dimColor>
          {`Observing ${entityUrl}${closed ? `` : ` (Ctrl+C to stop)`}`}
        </Text>
      </Box>
      <Box
        borderStyle="single"
        borderColor="gray"
        flexDirection="column"
        paddingX={1}
      >
        {timeline.length === 0 ? (
          <Text dimColor>Waiting for events...</Text>
        ) : null}
        {timeline.map((section, i) => {
          if (section.kind === `user_message`) {
            return (
              <UserMessageView
                key={`msg-${i}`}
                msg={{
                  key: `timeline-${i}`,
                  from: section.from ?? `user`,
                  payload: { text: section.text },
                  timestamp: new Date(section.timestamp).toISOString(),
                }}
              />
            )
          }

          return (
            <AgentResponseView
              key={`agent-${i}`}
              section={section}
              label={entityUrl}
              isStreaming={!closed && i === lastAgentIndex && !section.done}
            />
          )
        })}
        {closed ? (
          <Box marginTop={1}>
            <Text color="yellow">{`⚠ Entity stopped`}</Text>
          </Box>
        ) : null}
      </Box>
      {closed ? (
        <Box marginTop={1}>
          <Text color="yellow">{`Stream closed`}</Text>
          <Newline />
        </Box>
      ) : null}
      <MessageInput
        db={db}
        baseUrl={baseUrl}
        entityUrl={entityUrl}
        identity={identity}
        disabled={closed}
      />
    </Box>
  )
}

function ObserveApp({
  entityUrl,
  baseUrl,
  identity,
  initialOffset,
}: {
  entityUrl: string
  baseUrl: string
  identity: string
  initialOffset?: string
}): React.ReactElement {
  const [db, setDb] = useState<EntityStreamDB | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false

    createEntityStreamDB({ baseUrl, entityUrl, initialOffset })
      .then((result) => {
        if (cancelled) {
          result.close()
          return
        }
        closeRef.current = result.close
        setDb(result.db)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })

    return () => {
      cancelled = true
      closeRef.current?.()
    }
  }, [baseUrl, entityUrl, initialOffset])

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">{`Error: ${error}`}</Text>
      </Box>
    )
  }

  if (!db) {
    return (
      <Box>
        <Text dimColor>{`Connecting to ${entityUrl}...`}</Text>
      </Box>
    )
  }

  return (
    <ObserveView
      db={db}
      entityUrl={entityUrl}
      baseUrl={baseUrl}
      identity={identity}
    />
  )
}

// ============================================================================
// Public API
// ============================================================================

export function renderObserve(opts: {
  entityUrl: string
  baseUrl: string
  identity: string
  initialOffset?: string
}): void {
  const { entityUrl, baseUrl, identity, initialOffset } = opts

  const app = render(
    <ObserveApp
      entityUrl={entityUrl}
      baseUrl={baseUrl}
      identity={identity}
      initialOffset={initialOffset}
    />
  )

  process.on(`SIGINT`, () => {
    app.unmount()
    process.exit(0)
  })
}
