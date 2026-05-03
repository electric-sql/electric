import { memo, useMemo, useState } from 'react'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '../lib/codeHighlighter'
import { Badge, Code, ScrollArea, Stack, Text } from '../ui'
import type { BadgeTone } from '../ui'
import toolBlock from './toolBlock.module.css'
import styles from './CodingSessionTimeline.module.css'
import type {
  CodingSessionEventRow,
  CodingSessionMetaRow,
  CodingSessionStatus,
} from '../hooks/useCodingSession'

const codePluginSingleton = createCodePlugin()
const streamdownPlugins = { code: codePluginSingleton }

export function CodingSessionTimeline({
  events,
  meta,
  loading,
  error,
}: {
  events: Array<CodingSessionEventRow>
  meta: CodingSessionMetaRow | undefined
  loading: boolean
  error: string | null
}): React.ReactElement {
  const items = useMemo(() => renderItems(events), [events])

  return (
    <ScrollArea className={styles.scroll}>
      <Stack direction="column" gap={3} className={styles.list}>
        {meta && <MetaRow meta={meta} />}
        {error && (
          <Text size={2} tone="danger">
            {error}
          </Text>
        )}
        {!loading && events.length === 0 && !error && (
          <Text size={1} tone="muted" align="center">
            No events yet. Send a prompt to start the session.
          </Text>
        )}
        {items}
      </Stack>
    </ScrollArea>
  )
}

function renderItems(
  events: Array<CodingSessionEventRow>
): Array<React.ReactNode> {
  // Pair tool_call with tool_result by callId. We need both maps to
  // detect orphan tool_results (results whose corresponding call lives
  // before the tail cursor and isn't in `events`): looking the result
  // up in `resultsByCallId` would always succeed (we just inserted it),
  // so the orphan check has to query `callsByCallId` instead.
  const resultsByCallId = new Map<string, CodingSessionEventRow>()
  const callsByCallId = new Map<string, CodingSessionEventRow>()
  for (const e of events) {
    const callId = (e.payload.callId as string | undefined) ?? e.callId
    if (!callId) continue
    if (e.type === `tool_result`) resultsByCallId.set(callId, e)
    else if (e.type === `tool_call`) callsByCallId.set(callId, e)
  }

  const rendered = new Set<string>()
  const items: Array<React.ReactNode> = []

  for (const e of events) {
    const key = e.key
    switch (e.type) {
      case `session_init`:
      case `session_end`:
        break
      case `turn_complete`:
        items.push(<TurnDivider key={key} event={e} />)
        break
      case `turn_aborted`:
        items.push(<TurnAbortedRow key={key} event={e} />)
        break
      case `user_message`:
        items.push(<UserMessageRow key={key} event={e} />)
        break
      case `assistant_message`:
        items.push(<AssistantMessageRow key={key} event={e} />)
        break
      case `thinking`:
        items.push(<ThinkingRow key={key} event={e} />)
        break
      case `tool_call`: {
        const callId =
          (e.payload.callId as string | undefined) ?? e.callId ?? key
        if (rendered.has(callId)) break
        rendered.add(callId)
        items.push(
          <ToolBlock key={key} call={e} result={resultsByCallId.get(callId)} />
        )
        break
      }
      case `tool_result`: {
        const callId = (e.payload.callId as string | undefined) ?? e.callId
        if (callId && !callsByCallId.has(callId)) {
          items.push(<OrphanToolResult key={key} event={e} />)
        }
        break
      }
      case `permission_request`:
        items.push(<PermissionRequestRow key={key} event={e} />)
        break
      case `permission_response`:
        items.push(<PermissionResponseRow key={key} event={e} />)
        break
      case `compaction`:
        items.push(<CompactionRow key={key} />)
        break
      case `error`:
        items.push(<ErrorRow key={key} event={e} />)
        break
      default:
        items.push(<UnknownRow key={key} event={e} />)
    }
  }
  return items
}

function MetaRow({ meta }: { meta: CodingSessionMetaRow }): React.ReactElement {
  return (
    <Stack direction="column" gap={1} className={styles.metaCard}>
      <Stack gap={2} align="center" wrap>
        <Badge tone="neutral" variant="soft">
          {meta.agent}
        </Badge>
        <StatusBadge status={meta.status} />
        {meta.nativeSessionId && (
          <Text
            size={1}
            tone="muted"
            family="mono"
            className={styles.nativeSessionId}
            title={meta.nativeSessionId}
          >
            {meta.nativeSessionId}
          </Text>
        )}
      </Stack>
      {meta.cwd && (
        <Text size={1} tone="muted" family="mono" className={styles.cwd}>
          {meta.cwd}
        </Text>
      )}
      {meta.error && (
        <Text size={1} tone="danger">
          {meta.error}
        </Text>
      )}
    </Stack>
  )
}

function StatusBadge({
  status,
}: {
  status: CodingSessionStatus
}): React.ReactElement {
  const tone: BadgeTone =
    status === `running`
      ? `info`
      : status === `error`
        ? `danger`
        : status === `initializing`
          ? `neutral`
          : `success`
  return (
    <Badge tone={tone} variant="soft">
      {status}
    </Badge>
  )
}

function getText(e: CodingSessionEventRow, field: string): string {
  const v = e.payload[field]
  return typeof v === `string` ? v : ``
}

const UserMessageRow = memo(function UserMessageRow({
  event,
}: {
  event: CodingSessionEventRow
}): React.ReactElement {
  const text = getText(event, `text`)
  const user = event.payload.user as { name?: string } | undefined
  const pending = event.payload._pending === true
  return (
    <Stack
      direction="column"
      gap={1}
      className={`${styles.userBubble} ${pending ? styles.userBubblePending : ``}`}
    >
      <Stack p={3} className={styles.userBubbleInner}>
        <Text size={2} className={styles.userBubbleText}>
          {text}
        </Text>
      </Stack>
      <Stack gap={2} align="center" className={styles.userMeta}>
        <Text size={1} tone="muted">
          {user?.name ?? `user`}
        </Text>
        <Text size={1} tone="muted">
          ·
        </Text>
        <Text size={1} tone="muted">
          {pending ? `queued` : formatTime(event.ts)}
        </Text>
      </Stack>
    </Stack>
  )
})

const AssistantMessageRow = memo(function AssistantMessageRow({
  event,
}: {
  event: CodingSessionEventRow
}): React.ReactElement {
  const text = getText(event, `text`)
  const phase = event.payload.phase as `commentary` | `final` | undefined
  return (
    <Stack direction="column" gap={1}>
      <Stack gap={2} align="center" className={styles.assistantHeader}>
        <Text size={1} tone="muted">
          Assistant{phase === `commentary` ? ` · commentary` : ``}
        </Text>
        <Text size={1} tone="muted">
          ·
        </Text>
        <Text size={1} tone="muted">
          {formatTime(event.ts)}
        </Text>
      </Stack>
      <div className={`agent-ui-markdown ${styles.assistantMarkdown}`}>
        <Streamdown plugins={streamdownPlugins} linkSafety={{ enabled: false }}>
          {text}
        </Streamdown>
      </div>
    </Stack>
  )
})

function ThinkingRow({
  event,
}: {
  event: CodingSessionEventRow
}): React.ReactElement {
  const summary = getText(event, `summary`) || `thinking…`
  return (
    <Text size={1} tone="muted" className={styles.thinking}>
      {summary}
    </Text>
  )
}

function ToolBlock({
  call,
  result,
}: {
  call: CodingSessionEventRow
  result?: CodingSessionEventRow
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const tool = getText(call, `tool`) || `tool`
  const input =
    (call.payload.input as Record<string, unknown> | undefined) ?? {}
  const summary = summarizeToolInput(input)
  const isError = result?.payload.isError === true
  const tone: BadgeTone = !result ? `neutral` : isError ? `danger` : `success`
  const statusLabel = !result ? `running` : isError ? `error` : `ok`
  const output = getText(result ?? call, `output`)

  return (
    <Stack direction="column" className={toolBlock.card}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`${toolBlock.header} ${toolBlock.headerToggle}`}
      >
        <span className={toolBlock.toggleArrow}>{expanded ? `▼` : `▶`}</span>
        <span className={toolBlock.toolName}>{tool}</span>
        {summary && <span className={toolBlock.summary}>{summary}</span>}
        <Badge tone={tone} variant="soft" className={toolBlock.statusBadge}>
          {statusLabel}
        </Badge>
      </button>
      {expanded && (
        <Stack direction="column" gap={2} className={toolBlock.body}>
          <Text size={1} tone="muted" weight="medium">
            Input
          </Text>
          <pre className={toolBlock.codeBlock}>
            {JSON.stringify(input, null, 2)}
          </pre>
          {result && (
            <>
              <Text size={1} tone="muted" weight="medium">
                Output
              </Text>
              <pre className={toolBlock.codeBlock}>{output}</pre>
            </>
          )}
        </Stack>
      )}
    </Stack>
  )
}

function summarizeToolInput(input: Record<string, unknown>): string {
  for (const field of [
    `command`,
    `cmd`,
    `file_path`,
    `path`,
    `pattern`,
    `url`,
    `query`,
  ]) {
    const v = input[field]
    if (typeof v === `string`) return v
  }
  return ``
}

function OrphanToolResult({
  event,
}: {
  event: CodingSessionEventRow
}): React.ReactElement {
  const output = getText(event, `output`)
  return (
    <Text size={1} tone="muted" family="mono">
      (orphan result {event.callId ?? ``}) {output.slice(0, 120)}
    </Text>
  )
}

function PermissionRequestRow({
  event,
}: {
  event: CodingSessionEventRow
}): React.ReactElement {
  const tool = getText(event, `tool`)
  const input = event.payload.input as Record<string, unknown> | undefined
  return (
    <Stack p={2} className={styles.permissionRequest}>
      <Text size={2}>
        <strong>Approval requested</strong> for{` `}
        <Code>{tool}</Code>:{` `}
        <Code>{JSON.stringify(input ?? {}).slice(0, 80)}</Code>
      </Text>
    </Stack>
  )
}

function PermissionResponseRow({
  event,
}: {
  event: CodingSessionEventRow
}): React.ReactElement {
  const decision = getText(event, `decision`)
  const user = event.payload.user as { name?: string } | undefined
  return (
    <Text size={2} tone="muted">
      <strong>{user?.name ?? `user`}</strong> {decision}
    </Text>
  )
}

function CompactionRow(): React.ReactElement {
  return (
    <Stack justify="center">
      <Badge tone="neutral" variant="soft">
        compacted
      </Badge>
    </Stack>
  )
}

function ErrorRow({
  event,
}: {
  event: CodingSessionEventRow
}): React.ReactElement {
  const code = getText(event, `code`) || `error`
  const message = getText(event, `message`)
  return (
    <Stack p={2} direction="column" className={styles.errorRow}>
      <Text size={2} tone="danger">
        <strong>{code}:</strong> {message}
      </Text>
    </Stack>
  )
}

function TurnDivider({
  event,
}: {
  event: CodingSessionEventRow
}): React.ReactElement {
  const usage = event.payload.usage as
    | { inputTokens?: number; outputTokens?: number; costUsd?: number }
    | undefined
  return (
    <Stack align="center" gap={2} className={styles.turnDivider}>
      <Text size={1} tone="muted">
        turn complete
      </Text>
      {usage?.inputTokens !== undefined && usage.outputTokens !== undefined && (
        <Text size={1} tone="muted" family="mono">
          {usage.inputTokens}↑ {usage.outputTokens}↓
        </Text>
      )}
    </Stack>
  )
}

function TurnAbortedRow({
  event,
}: {
  event: CodingSessionEventRow
}): React.ReactElement {
  const reason = getText(event, `reason`)
  return (
    <Text size={1} tone="muted">
      turn aborted{reason ? ` — ${reason}` : ``}
    </Text>
  )
}

function UnknownRow({
  event,
}: {
  event: CodingSessionEventRow
}): React.ReactElement {
  return (
    <Text size={1} tone="muted" family="mono">
      [{event.type}]
    </Text>
  )
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: `2-digit`,
    minute: `2-digit`,
  })
}
