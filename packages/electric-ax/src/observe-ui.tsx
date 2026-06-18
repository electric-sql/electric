import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Newline, Text, render, useInput } from 'ink'
import { createOptimisticAction, useLiveQuery } from '@tanstack/react-db'
import {
  createEntityTimelineQuery,
  createPendingTimelineOrder,
} from '@electric-ax/agents-runtime'
import { entityApiUrl } from './entity-api.js'
import { createEntityStreamDB } from './entity-stream-db'
import type {
  EntityTimelineContentItem,
  EntityTimelineQueryRow,
  EntityTimelineRunItem,
  EntityTimelineRunRow,
  EntityTimelineSection,
  MessageReceived,
} from '@electric-ax/agents-runtime'
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

export function createMessageSendBody(
  text: string,
  opts?: { key?: string }
): { key?: string; payload: { text: string } } {
  return { ...(opts?.key ? { key: opts.key } : {}), payload: { text } }
}

const OPTIMISTIC_INBOX_ORDER_START = Number.MAX_SAFE_INTEGER - 1_000_000
const SEND_TXID_TIMEOUT_MS = 10_000

let optimisticInboxOrderIndex = OPTIMISTIC_INBOX_ORDER_START

function nextOptimisticInboxOrderIndex(): number {
  optimisticInboxOrderIndex += 1
  if (optimisticInboxOrderIndex >= Number.MAX_SAFE_INTEGER) {
    optimisticInboxOrderIndex = OPTIMISTIC_INBOX_ORDER_START
  }
  return optimisticInboxOrderIndex
}

function createOptimisticInboxKey(pendingOrderIndex: number): string {
  return `optimistic-${Date.now()}-${pendingOrderIndex}`
}

async function readSendTxid(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as { txid?: unknown } | null
  const txid = data?.txid
  if (typeof txid === `string` || typeof txid === `number`) {
    return String(txid)
  }
  throw new Error(`Send response did not include txid`)
}

function GutterLine({
  prefix = `│ `,
  color,
  dimColor,
  children,
}: {
  prefix?: string
  color?: string
  dimColor?: boolean
  children: string
}): React.ReactElement {
  return (
    <Box width="100%">
      <Text color={color} dimColor={dimColor}>
        {prefix}
      </Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={color} dimColor={dimColor} wrap="wrap">
          {children}
        </Text>
      </Box>
    </Box>
  )
}

function payloadText(payload: unknown): string {
  if (typeof payload === `string`) return payload
  if (typeof payload === `object` && payload !== null) {
    const record = payload as Record<string, unknown>
    return typeof record.text === `string`
      ? record.text
      : JSON.stringify(payload)
  }
  return String(payload ?? ``)
}

function resultText(result: unknown): string | undefined {
  if (result === undefined) return undefined
  return typeof result === `string` ? result : JSON.stringify(result)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null && !Array.isArray(value)
}

type TimelineDisplayRow =
  | { kind: `section`; key: string; section: EntityTimelineSection }
  | { kind: `run`; key: string; run: EntityTimelineRunRow }

function timelineRowsToDisplayRows(
  rows: Array<EntityTimelineQueryRow>
): Array<TimelineDisplayRow> {
  let userMessageCount = 0
  return rows.flatMap((row): Array<TimelineDisplayRow> => {
    if (row.inbox) {
      const section: EntityTimelineSection = {
        kind: `user_message`,
        from: row.inbox.from,
        text: payloadText(row.inbox.payload),
        timestamp: Date.parse(row.inbox.timestamp || ``) || Date.now(),
        isInitial: userMessageCount === 0,
      }
      userMessageCount++
      return [{ kind: `section`, key: row.$key, section }]
    }

    if (row.wake) {
      const timestamp = Date.parse(row.wake.payload.timestamp)
      return [
        {
          kind: `section`,
          key: row.$key,
          section: {
            kind: `wake`,
            payload: row.wake.payload,
            timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
          },
        },
      ]
    }

    if (row.run) {
      return [{ kind: `run`, key: row.$key, run: row.run }]
    }

    if (row.error) {
      return [
        {
          kind: `section`,
          key: row.$key,
          section: {
            kind: `agent_response`,
            items: [],
            error: row.error.error_code
              ? `${row.error.error_code}: ${row.error.message}`
              : row.error.message,
          },
        },
      ]
    }

    return []
  })
}

function textContent(item: { content?: unknown } | null | undefined): string {
  return typeof item?.content === `string` ? item.content : ``
}

function compareTimelineOrderValues(
  left: string | number,
  right: string | number
): number {
  if (typeof left === `number` && typeof right === `number`) {
    return left - right
  }
  return String(left).localeCompare(String(right))
}

export function runItemKind(item: EntityTimelineRunItem): `text` | `toolCall` {
  return item.text ? `text` : `toolCall`
}

export function runItemKey(item: EntityTimelineRunItem): string {
  return item.text?.key ?? item.toolCall?.key ?? ``
}

export function compareRunItems(
  left: EntityTimelineRunItem,
  right: EntityTimelineRunItem
): number {
  const orderCompare = compareTimelineOrderValues(
    left.text?.order ?? left.toolCall?.order ?? `~`,
    right.text?.order ?? right.toolCall?.order ?? `~`
  )
  if (orderCompare !== 0) return orderCompare

  const kindCompare = runItemKind(left).localeCompare(runItemKind(right))
  if (kindCompare !== 0) return kindCompare

  return runItemKey(left).localeCompare(runItemKey(right))
}

export function runItemsToContentItems(
  items: Array<EntityTimelineRunItem>
): Array<EntityTimelineContentItem> {
  const contentItems: Array<EntityTimelineContentItem> = []
  for (const item of items) {
    if (item.text) {
      const content = textContent(item.text)
      if (content.trim().length > 0) {
        contentItems.push({ kind: `text`, text: content })
      }
      continue
    }

    if (!item.toolCall) continue
    contentItems.push({
      kind: `tool_call`,
      toolCallId: item.toolCall.tool_call_id ?? item.toolCall.key,
      toolName: item.toolCall.tool_name,
      args: isPlainObject(item.toolCall.args) ? item.toolCall.args : {},
      status: item.toolCall.status,
      result: resultText(item.toolCall.result),
      error: item.toolCall.error,
      isError: item.toolCall.status === `failed`,
    })
  }
  return contentItems
}

function runErrorsText(
  errors: EntityTimelineRunRow[`errors`][`toArray`]
): string | undefined {
  const messages = errors
    .map((error) =>
      error.error_code ? `${error.error_code}: ${error.message}` : error.message
    )
    .filter(Boolean)
  return messages.length > 0 ? messages.join(`; `) : undefined
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
        <GutterLine key={i} color="white">
          {line}
        </GutterLine>
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
        <GutterLine key={i} color="white">
          {`${line}${i === lines.length - 1 ? cursor : ``}`}
        </GutterLine>
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
        <GutterLine key={i} prefix="    │ " dimColor>
          {truncate(line, 100)}
        </GutterLine>
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
  headers,
  disabled,
}: {
  db: EntityStreamDB
  baseUrl: string
  entityUrl: string
  identity: string
  headers?: Record<string, string>
  disabled: boolean
}): React.ReactElement {
  const [value, setValue] = useState(``)
  const [error, setError] = useState<string | null>(null)

  const sendAction = useMemo(
    () =>
      createOptimisticAction<{
        text: string
        key: string
        pendingOrderIndex: number
      }>({
        onMutate: ({ text, key, pendingOrderIndex }) => {
          const now = new Date().toISOString()
          db.collections.inbox.insert({
            key,
            _timeline_order: createPendingTimelineOrder(pendingOrderIndex),
            from: identity,
            from_principal: identity,
            payload: { text },
            timestamp: now,
            mode: `immediate`,
            status: `processed`,
            processed_at: now,
          } as any)
        },
        mutationFn: async ({ text, key }) => {
          const res = await fetch(entityApiUrl(baseUrl, entityUrl, `/send`), {
            method: `POST`,
            headers: {
              'content-type': `application/json`,
              ...headers,
            },
            body: JSON.stringify(createMessageSendBody(text, { key })),
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
          await db.utils.awaitTxId(
            await readSendTxid(res),
            SEND_TXID_TIMEOUT_MS
          )
        },
      }),
    [db, baseUrl, entityUrl, identity, headers]
  )

  useInput(
    (input, key) => {
      if (disabled) return

      if (key.return) {
        if (value.trim()) {
          setError(null)
          const pendingOrderIndex = nextOptimisticInboxOrderIndex()
          const tx = sendAction({
            text: value.trim(),
            key: createOptimisticInboxKey(pendingOrderIndex),
            pendingOrderIndex,
          })
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
    <Box flexDirection="column" width="100%">
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

function AgentRunView({
  run,
  label,
  isStreaming,
}: {
  run: EntityTimelineRunRow
  label: string
  isStreaming: boolean
}): React.ReactElement {
  const { data: items = [] } = useLiveQuery(
    (q) => (run.items ? q.from({ item: run.items as any }) : undefined),
    [run.items]
  )
  const { data: errors = [] } = useLiveQuery(
    (q) => (run.errors ? q.from({ error: run.errors as any }) : undefined),
    [run.errors]
  )

  const sortedItems = useMemo(
    () => [...(items as Array<EntityTimelineRunItem>)].sort(compareRunItems),
    [items]
  )
  const runErrors = useMemo(
    () => runErrorsText(errors as EntityTimelineRunRow[`errors`][`toArray`]),
    [errors]
  )
  const finishReason =
    run.status === `failed` && run.finish_reason
      ? `finish_reason=${run.finish_reason}`
      : undefined
  const section = useMemo<
    Extract<EntityTimelineSection, { kind: `agent_response` }>
  >(
    () => ({
      kind: `agent_response`,
      items: runItemsToContentItems(sortedItems),
      ...(run.status === `completed` && { done: true as const }),
      ...(runErrors || finishReason
        ? { error: runErrors || finishReason }
        : {}),
      ...(run.tokens && { tokens: run.tokens }),
    }),
    [finishReason, run.status, run.tokens, runErrors, sortedItems]
  )

  return (
    <AgentResponseView
      section={section}
      label={label}
      isStreaming={isStreaming}
    />
  )
}

function wakeReason(
  section: Extract<EntityTimelineSection, { kind: `wake` }>
): string {
  const { payload } = section
  if (payload.timeout) return `timeout`
  if (payload.finished_child) {
    return `child ${payload.finished_child.run_status}`
  }
  if (payload.changes.length > 0) {
    return `${payload.changes.length} ${payload.changes.length === 1 ? `change` : `changes`}`
  }
  if (payload.other_children && payload.other_children.length > 0) {
    return `${payload.other_children.length} child ${payload.other_children.length === 1 ? `update` : `updates`}`
  }
  return payload.source
}

function WakeView({
  section,
}: {
  section: Extract<EntityTimelineSection, { kind: `wake` }>
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text bold color="magenta">{`┌ wake`}</Text>
        <Text dimColor>
          {`  ${formatTime(new Date(section.timestamp).toISOString())}`}
        </Text>
      </Text>
      <Text dimColor>
        {`│ ${wakeReason(section)} from ${section.payload.source}`}
      </Text>
    </Box>
  )
}

// ============================================================================
// Main observe component — reads from StreamDB collections
// ============================================================================

export function ObserveExitHotkey({
  onExit,
}: {
  onExit: () => void
}): React.ReactElement | null {
  useInput((_input, key) => {
    if (key.escape) {
      onExit()
    }
  })
  return null
}

export function ObserveView({
  db,
  entityUrl,
  baseUrl,
  identity,
  headers,
}: {
  db: EntityStreamDB
  entityUrl: string
  baseUrl: string
  identity: string
  headers?: Record<string, string>
}): React.ReactElement {
  const timelineQuery = useMemo(() => createEntityTimelineQuery(db), [db])
  const { data: timelineRows = [] } = useLiveQuery(timelineQuery as any, [
    timelineQuery,
  ])
  const displayRows = useMemo(
    () =>
      timelineRowsToDisplayRows(timelineRows as Array<EntityTimelineQueryRow>),
    [timelineRows]
  )
  const { data: entityStoppedRows = [] } = useLiveQuery(
    (q) => q.from({ stopped: db.collections.entityStopped as any }),
    [db.collections.entityStopped]
  )
  const closed = entityStoppedRows.length > 0

  const lastAgentIndex = useMemo(() => {
    for (let i = displayRows.length - 1; i >= 0; i--) {
      const row = displayRows[i]!
      if (
        row.kind === `run` ||
        (row.kind === `section` && row.section.kind === `agent_response`)
      ) {
        return i
      }
    }
    return -1
  }, [displayRows])

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} width="100%">
        <Text dimColor>
          {`Observing ${entityUrl}${closed ? `` : ` (Ctrl+C to stop)`}`}
        </Text>
      </Box>
      <Box
        width="100%"
        borderStyle="single"
        borderColor="gray"
        flexDirection="column"
        paddingX={1}
      >
        {displayRows.length === 0 ? (
          <Text dimColor>Waiting for events...</Text>
        ) : null}
        {displayRows.map((row, i) => {
          if (row.kind === `run`) {
            return (
              <AgentRunView
                key={row.key}
                run={row.run}
                label={entityUrl}
                isStreaming={
                  !closed &&
                  i === lastAgentIndex &&
                  row.run.status !== `completed`
                }
              />
            )
          }

          const { section } = row
          if (section.kind === `user_message`) {
            return (
              <UserMessageView
                key={row.key}
                msg={{
                  key: `timeline-${i}`,
                  from: section.from ?? `user`,
                  payload: { text: section.text },
                  timestamp: new Date(section.timestamp).toISOString(),
                }}
              />
            )
          }

          if (section.kind === `wake`) {
            return <WakeView key={row.key} section={section} />
          }

          return (
            <AgentResponseView
              key={row.key}
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
        headers={headers}
        disabled={closed}
      />
    </Box>
  )
}

function ObserveApp({
  entityUrl,
  baseUrl,
  identity,
  headers,
  initialOffset,
  onExit,
}: {
  entityUrl: string
  baseUrl: string
  identity: string
  headers?: Record<string, string>
  initialOffset?: string
  onExit: () => void
}): React.ReactElement {
  const [db, setDb] = useState<EntityStreamDB | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false

    createEntityStreamDB({
      baseUrl,
      entityUrl,
      initialOffset,
      headers,
    })
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
  }, [baseUrl, entityUrl, initialOffset, headers])

  if (error) {
    return (
      <Box flexDirection="column">
        <ObserveExitHotkey onExit={onExit} />
        <Text color="red">{`Error: ${error}`}</Text>
      </Box>
    )
  }

  if (!db) {
    return (
      <Box>
        <ObserveExitHotkey onExit={onExit} />
        <Text dimColor>{`Connecting to ${entityUrl}...`}</Text>
      </Box>
    )
  }

  return (
    <>
      <ObserveExitHotkey onExit={onExit} />
      <ObserveView
        db={db}
        entityUrl={entityUrl}
        baseUrl={baseUrl}
        identity={identity}
        headers={headers}
      />
    </>
  )
}

// ============================================================================
// Public API
// ============================================================================

export function renderObserve(opts: {
  entityUrl: string
  baseUrl: string
  identity: string
  headers?: Record<string, string>
  initialOffset?: string
}): void {
  const { entityUrl, baseUrl, identity, headers, initialOffset } = opts

  let app: ReturnType<typeof render>
  const exit = (): void => {
    app.unmount()
    process.exit(0)
  }

  app = render(
    <ObserveApp
      entityUrl={entityUrl}
      baseUrl={baseUrl}
      identity={identity}
      headers={headers}
      initialOffset={initialOffset}
      onExit={exit}
    />
  )

  process.on(`SIGINT`, exit)
}
