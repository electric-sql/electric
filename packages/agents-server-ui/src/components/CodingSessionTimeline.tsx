import { memo, useMemo, useState } from 'react'
import { Badge, Flex, ScrollArea, Text } from '@radix-ui/themes'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '../lib/codeHighlighter'
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
    <ScrollArea style={{ flex: 1, width: `100%` }}>
      <Flex
        direction="column"
        gap="3"
        style={{
          maxWidth: `72ch`,
          width: `100%`,
          margin: `0 auto`,
          padding: `16px 40px`,
          boxSizing: `border-box`,
        }}
      >
        {meta && <MetaRow meta={meta} />}
        {error && (
          <Text size="2" color="red">
            {error}
          </Text>
        )}
        {!loading && events.length === 0 && !error && (
          <Text size="1" color="gray" align="center">
            No events yet. Send a prompt to start the session.
          </Text>
        )}
        {items}
      </Flex>
    </ScrollArea>
  )
}

function renderItems(
  events: Array<CodingSessionEventRow>
): Array<React.ReactNode> {
  // Pair tool_call with tool_result by callId.
  const resultsByCallId = new Map<string, CodingSessionEventRow>()
  for (const e of events) {
    if (e.type === `tool_result`) {
      const callId = (e.payload.callId as string | undefined) ?? e.callId
      if (callId) resultsByCallId.set(callId, e)
    }
  }

  const rendered = new Set<string>()
  const items: Array<React.ReactNode> = []

  for (const e of events) {
    const key = e.key
    switch (e.type) {
      case `session_init`:
      case `session_end`:
        break // invisible
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
      case `tool_result`:
        // Rendered inline with its tool_call. Fall through — a stray
        // result (no matching call) is uncommon; show it as a tiny note.
        if (
          e.callId &&
          !resultsByCallId.has(
            (e.payload.callId as string | undefined) ?? e.callId
          )
        ) {
          items.push(<OrphanToolResult key={key} event={e} />)
        }
        break
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
    <Flex
      direction="column"
      gap="1"
      style={{
        padding: `8px 12px`,
        background: `var(--gray-a2)`,
        border: `1px solid var(--gray-a4)`,
        borderRadius: `var(--radius-2)`,
      }}
    >
      <Flex gap="2" align="center" wrap="wrap">
        <Badge color="gray" variant="soft">
          {meta.agent}
        </Badge>
        <StatusBadge status={meta.status} />
        {meta.nativeSessionId && (
          <Text
            size="1"
            color="gray"
            style={{
              fontFamily: `var(--font-mono)`,
              wordBreak: `break-all`,
            }}
            title={meta.nativeSessionId}
          >
            {meta.nativeSessionId}
          </Text>
        )}
      </Flex>
      {meta.cwd && (
        <Text size="1" color="gray" style={{ fontFamily: `var(--font-mono)` }}>
          {meta.cwd}
        </Text>
      )}
      {meta.error && (
        <Text size="1" color="red">
          {meta.error}
        </Text>
      )}
    </Flex>
  )
}

function StatusBadge({
  status,
}: {
  status: CodingSessionStatus
}): React.ReactElement {
  const color =
    status === `running`
      ? `blue`
      : status === `error`
        ? `red`
        : status === `initializing`
          ? `gray`
          : `green`
  return (
    <Badge color={color} variant="soft">
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
    <Flex
      direction="column"
      gap="1"
      style={{ maxWidth: `68ch`, opacity: pending ? 0.65 : 1 }}
    >
      <Flex p="3" style={{ background: `var(--gray-a3)`, borderRadius: 12 }}>
        <Text size="2" style={{ lineHeight: 1.55, whiteSpace: `pre-wrap` }}>
          {text}
        </Text>
      </Flex>
      <Flex gap="2" align="center" style={{ opacity: 0.4 }}>
        <Text size="1" color="gray">
          {user?.name ?? `user`}
        </Text>
        <Text size="1" color="gray">
          ·
        </Text>
        <Text size="1" color="gray">
          {pending ? `queued` : formatTime(event.ts)}
        </Text>
      </Flex>
    </Flex>
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
    <Flex direction="column" gap="1">
      <Flex gap="2" align="center" style={{ opacity: 0.6 }}>
        <Text size="1" color="gray">
          Assistant{phase === `commentary` ? ` · commentary` : ``}
        </Text>
        <Text size="1" color="gray">
          ·
        </Text>
        <Text size="1" color="gray">
          {formatTime(event.ts)}
        </Text>
      </Flex>
      <div
        className="agent-ui-markdown"
        style={{
          borderLeft: `3px solid var(--accent-7)`,
          paddingLeft: 20,
          paddingTop: 4,
          paddingBottom: 4,
        }}
      >
        <Streamdown plugins={streamdownPlugins} linkSafety={{ enabled: false }}>
          {text}
        </Streamdown>
      </div>
    </Flex>
  )
})

function ThinkingRow({
  event,
}: {
  event: CodingSessionEventRow
}): React.ReactElement {
  const summary = getText(event, `summary`) || `thinking…`
  return (
    <Text
      size="1"
      color="gray"
      style={{
        fontStyle: `italic`,
        opacity: 0.7,
        borderLeft: `2px solid var(--gray-a5)`,
        paddingLeft: 12,
      }}
    >
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
  const statusColor = !result ? `gray` : isError ? `red` : `green`
  const statusLabel = !result ? `running` : isError ? `error` : `ok`
  const output = getText(result ?? call, `output`)

  return (
    <Flex
      direction="column"
      style={{
        border: `1px solid var(--gray-a4)`,
        borderRadius: `var(--radius-2)`,
        overflow: `hidden`,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          all: `unset`,
          display: `flex`,
          alignItems: `center`,
          gap: 8,
          padding: `6px 10px`,
          cursor: `pointer`,
          background: `var(--gray-a2)`,
          fontSize: `var(--font-size-2)`,
          fontFamily: `var(--font-mono)`,
        }}
      >
        <span style={{ opacity: 0.5 }}>{expanded ? `▼` : `▶`}</span>
        <span style={{ fontWeight: 500 }}>{tool}</span>
        {summary && (
          <span
            style={{
              color: `var(--gray-11)`,
              overflow: `hidden`,
              textOverflow: `ellipsis`,
              whiteSpace: `nowrap`,
              maxWidth: `36ch`,
            }}
          >
            {summary}
          </span>
        )}
        <Badge
          color={statusColor}
          variant="soft"
          style={{ marginLeft: `auto` }}
        >
          {statusLabel}
        </Badge>
      </button>
      {expanded && (
        <Flex
          direction="column"
          gap="2"
          style={{
            padding: `8px 12px`,
            borderTop: `1px solid var(--gray-a4)`,
            background: `var(--gray-a1)`,
          }}
        >
          <Text size="1" color="gray" weight="medium">
            Input
          </Text>
          <pre style={codeBlockStyle}>{JSON.stringify(input, null, 2)}</pre>
          {result && (
            <>
              <Text size="1" color="gray" weight="medium">
                Output
              </Text>
              <pre style={codeBlockStyle}>{output}</pre>
            </>
          )}
        </Flex>
      )}
    </Flex>
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
    <Text size="1" color="gray" style={{ fontFamily: `var(--font-mono)` }}>
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
    <Flex
      p="2"
      style={{
        background: `var(--amber-a3)`,
        border: `1px solid var(--amber-a5)`,
        borderRadius: `var(--radius-2)`,
      }}
    >
      <Text size="2">
        <strong>Approval requested</strong> for{` `}
        <code>{tool}</code>:{` `}
        <code>{JSON.stringify(input ?? {}).slice(0, 80)}</code>
      </Text>
    </Flex>
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
    <Text size="2" color="gray">
      <strong>{user?.name ?? `user`}</strong> {decision}
    </Text>
  )
}

function CompactionRow(): React.ReactElement {
  return (
    <Flex justify="center">
      <Badge color="gray" variant="soft">
        compacted
      </Badge>
    </Flex>
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
    <Flex
      p="2"
      direction="column"
      style={{
        background: `var(--red-a3)`,
        border: `1px solid var(--red-a5)`,
        borderRadius: `var(--radius-2)`,
      }}
    >
      <Text size="2" color="red">
        <strong>{code}:</strong> {message}
      </Text>
    </Flex>
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
    <Flex
      align="center"
      gap="2"
      style={{
        opacity: 0.35,
        borderTop: `1px dashed var(--gray-a5)`,
        paddingTop: 6,
      }}
    >
      <Text size="1" color="gray">
        turn complete
      </Text>
      {usage?.inputTokens !== undefined && usage.outputTokens !== undefined && (
        <Text size="1" color="gray" style={{ fontFamily: `var(--font-mono)` }}>
          {usage.inputTokens}↑ {usage.outputTokens}↓
        </Text>
      )}
    </Flex>
  )
}

function TurnAbortedRow({
  event,
}: {
  event: CodingSessionEventRow
}): React.ReactElement {
  const reason = getText(event, `reason`)
  return (
    <Text size="1" color="gray">
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
    <Text size="1" color="gray" style={{ fontFamily: `var(--font-mono)` }}>
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

const codeBlockStyle: React.CSSProperties = {
  margin: 0,
  padding: 8,
  background: `var(--gray-a2)`,
  border: `1px solid var(--gray-a4)`,
  borderRadius: `var(--radius-2)`,
  fontSize: `var(--font-size-1)`,
  fontFamily: `var(--font-mono)`,
  whiteSpace: `pre-wrap`,
  wordBreak: `break-word`,
  maxHeight: 320,
  overflow: `auto`,
}
