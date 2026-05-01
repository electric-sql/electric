// packages/agents-server-ui/src/components/CodingAgentTimeline.tsx
import { memo, useMemo, useState } from 'react'
import { Badge, Flex, ScrollArea, Text } from '@radix-ui/themes'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '../lib/codeHighlighter'
import { ToolCallView } from './ToolCallView'
import type { GenericToolCall } from './ToolCallView'
import type {
  SessionMetaRow,
  RunRow,
  EventRow,
  LifecycleRow,
} from '../hooks/useCodingAgent'

const codePluginSingleton = createCodePlugin()
const streamdownPlugins = { code: codePluginSingleton }

export function CodingAgentTimeline({
  meta,
  runs,
  events,
  lifecycle,
  loading,
  error,
}: {
  meta: SessionMetaRow | undefined
  runs: Array<RunRow>
  events: Array<EventRow>
  lifecycle: Array<LifecycleRow>
  loading: boolean
  error: string | null
}): React.ReactElement {
  const items = useMemo(
    () => renderItems(events, lifecycle),
    [events, lifecycle]
  )

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
        {meta && <AgentMetaRow meta={meta} runs={runs} />}
        {error && (
          <Text size="2" color="red">
            {error}
          </Text>
        )}
        {!loading &&
          events.length === 0 &&
          lifecycle.length === 0 &&
          !error && (
            <Text size="1" color="gray" align="center">
              No events yet. Send a prompt to start the agent.
            </Text>
          )}
        {items}
      </Flex>
    </ScrollArea>
  )
}

function AgentMetaRow({
  meta,
  runs,
}: {
  meta: SessionMetaRow
  runs: Array<RunRow>
}): React.ReactElement {
  const completedRuns = runs.filter((r) => r.status === `completed`).length
  const failedRuns = runs.filter((r) => r.status === `failed`).length
  return (
    <Flex gap="2" align="center" wrap="wrap">
      <Badge color="gray" variant="outline">
        {meta.kind}
      </Badge>
      <Badge color="gray" variant="outline">
        {meta.workspaceIdentity}
      </Badge>
      {completedRuns > 0 && (
        <Badge color="green" variant="soft">
          {completedRuns} run{completedRuns !== 1 ? `s` : ``}
        </Badge>
      )}
      {failedRuns > 0 && (
        <Badge color="red" variant="soft">
          {failedRuns} failed
        </Badge>
      )}
      {meta.pinned && (
        <Badge color="blue" variant="soft">
          pinned
        </Badge>
      )}
    </Flex>
  )
}

function renderItems(
  events: Array<EventRow>,
  lifecycle: Array<LifecycleRow>
): Array<React.ReactNode> {
  // Pair tool_call with tool_result by callId.
  const resultsByCallId = new Map<string, EventRow>()
  const callsByCallId = new Map<string, EventRow>()
  for (const e of events) {
    const callId = e.payload.callId as string | undefined
    if (!callId) continue
    if (e.type === `tool_result`) resultsByCallId.set(callId, e)
    else if (e.type === `tool_call`) callsByCallId.set(callId, e)
  }

  const rendered = new Set<string>()
  const items: Array<React.ReactNode> = []

  // Merge events + lifecycle, sorted by timestamp.
  type MergedItem =
    | { kind: `event`; ts: number; key: string; e: EventRow }
    | { kind: `lifecycle`; ts: number; key: string; l: LifecycleRow }

  const merged: MergedItem[] = [
    ...events.map((e) => ({
      kind: `event` as const,
      ts: e.ts,
      key: `e:${e.key}`,
      e,
    })),
    ...lifecycle.map((l) => ({
      kind: `lifecycle` as const,
      ts: l.ts,
      key: `l:${l.key}`,
      l,
    })),
  ].sort((a, b) => a.ts - b.ts)

  for (const item of merged) {
    if (item.kind === `lifecycle`) {
      items.push(<LifecycleEventRow key={item.key} row={item.l} />)
      continue
    }

    const e = item.e
    const key = e.key
    if (rendered.has(key)) continue

    switch (e.type) {
      case `session_init`:
        items.push(<SessionInitRow key={key} event={e} />)
        rendered.add(key)
        break
      case `user_message`:
        items.push(<UserMessageRow key={key} event={e} />)
        rendered.add(key)
        break
      case `assistant_message`:
        items.push(<AssistantMessageRow key={key} event={e} />)
        rendered.add(key)
        break
      case `tool_call`: {
        const callId = e.payload.callId as string | undefined
        const result = callId ? resultsByCallId.get(callId) : undefined
        if (result) rendered.add(result.key)
        items.push(<ToolCallRow key={key} call={e} result={result} />)
        rendered.add(key)
        break
      }
      case `tool_result`: {
        const callId = e.payload.callId as string | undefined
        if (callId && callsByCallId.has(callId)) {
          // Will be rendered with its tool_call.
          rendered.add(key)
          break
        }
        // Orphan result (call is before tail cursor).
        items.push(<OrphanResultRow key={key} event={e} />)
        rendered.add(key)
        break
      }
      case `turn_complete`:
      case `session_end`:
      case `compaction`:
        items.push(<SystemEventRow key={key} event={e} />)
        rendered.add(key)
        break
      case `thinking`:
        items.push(<ThinkingRow key={key} event={e} />)
        rendered.add(key)
        break
      case `turn_aborted`:
        items.push(<TurnAbortedRow key={key} event={e} />)
        rendered.add(key)
        break
      case `permission_request`:
        items.push(<PermissionRequestRow key={key} event={e} />)
        rendered.add(key)
        break
      case `permission_response`:
        items.push(<PermissionResponseRow key={key} event={e} />)
        rendered.add(key)
        break
      case `error`:
        items.push(<ErrorRow key={key} event={e} />)
        rendered.add(key)
        break
      default:
        items.push(<UnknownRow key={key} event={e} />)
        rendered.add(key)
    }
  }

  return items
}

function LifecycleEventRow({ row }: { row: LifecycleRow }): React.ReactElement {
  const label: Record<string, string> = {
    'sandbox.starting': `Sandbox starting`,
    'sandbox.started': `Sandbox started`,
    'sandbox.stopped': `Sandbox stopped`,
    'sandbox.failed': `Sandbox failed`,
    pin: `Pinned`,
    release: `Released`,
    'orphan.detected': `Orphan detected`,
    'resume.restored': `Session resumed`,
  }
  return (
    <Flex gap="2" align="center" style={{ opacity: 0.55 }}>
      <Text size="1" color="gray">
        {new Date(row.ts).toLocaleTimeString()}
      </Text>
      <Text size="1" color="gray">
        {label[row.event] ?? row.event}
        {row.detail ? ` — ${row.detail}` : ``}
      </Text>
    </Flex>
  )
}

function SessionInitRow({ event }: { event: EventRow }): React.ReactElement {
  const sessionId = event.payload.sessionId as string | undefined
  return (
    <Flex gap="2" align="center" style={{ opacity: 0.6 }}>
      <Text size="1" color="gray">
        Session started{sessionId ? ` (${sessionId.slice(0, 8)}…)` : ``}
      </Text>
    </Flex>
  )
}

const AssistantMessageRow = memo(function AssistantMessageRow({
  event,
}: {
  event: EventRow
}): React.ReactElement {
  const text = (event.payload.text as string | undefined) ?? ``
  return (
    <Flex direction="column" gap="1">
      <Text size="1" color="gray" weight="medium">
        Assistant
      </Text>
      <div style={{ fontSize: `var(--font-size-2)` }}>
        <Streamdown plugins={streamdownPlugins}>{text}</Streamdown>
      </div>
    </Flex>
  )
})

function UserMessageRow({ event }: { event: EventRow }): React.ReactElement {
  const text = (event.payload.text as string | undefined) ?? ``
  const pending = !!event.payload._pending
  return (
    <Flex
      direction="column"
      gap="1"
      style={{
        alignSelf: `flex-end`,
        maxWidth: `80%`,
        opacity: pending ? 0.6 : 1,
      }}
    >
      <Text size="1" color="gray" weight="medium" align="right">
        You{pending ? ` (queued)` : ``}
      </Text>
      <div
        style={{
          background: `var(--accent-a3)`,
          padding: `8px 12px`,
          borderRadius: `var(--radius-3)`,
          fontSize: `var(--font-size-2)`,
          whiteSpace: `pre-wrap`,
          wordBreak: `break-word`,
        }}
      >
        {text}
      </div>
    </Flex>
  )
}

function normaliseResultOutput(output: unknown): string | undefined {
  if (output === undefined || output === null) return undefined
  if (typeof output === `string`) return output
  return JSON.stringify(output)
}

function ToolCallRow({
  call,
  result,
}: {
  call: EventRow
  result: EventRow | undefined
}): React.ReactElement {
  // agent-session-protocol's ToolCallEvent uses `tool` (string) and `input`
  // (Record). Adapt to the GenericToolCall shape used by ToolCallView so the
  // visual style matches native tool calls rendered by EntityTimeline.
  const toolName = (call.payload.tool as string | undefined) ?? `tool`
  const args = (call.payload.input as Record<string, unknown> | undefined) ?? {}
  const resultOutput = result
    ? normaliseResultOutput(result.payload.output)
    : undefined
  const isError = result
    ? ((result.payload.isError as boolean | undefined) ?? false)
    : false

  const tc: GenericToolCall = {
    callId: call.payload.callId as string | undefined,
    toolName,
    args,
    status: result ? (isError ? `failed` : `completed`) : `started`,
    result: resultOutput,
    isError,
  }

  return <ToolCallView item={tc} />
}

function OrphanResultRow({
  event: _event,
}: {
  event: EventRow
}): React.ReactElement {
  return (
    <Flex gap="2" align="center" style={{ opacity: 0.5 }}>
      <Text size="1" color="gray">
        Tool result (call before window)
      </Text>
    </Flex>
  )
}

function SystemEventRow({ event }: { event: EventRow }): React.ReactElement {
  const label: Record<string, string> = {
    turn_complete: `Turn complete`,
    session_end: `Session ended`,
    compaction: `Context compacted`,
  }
  return (
    <Flex gap="2" align="center" style={{ opacity: 0.5 }}>
      <Text size="1" color="gray">
        {label[event.type] ?? event.type}
      </Text>
    </Flex>
  )
}

function ThinkingRow({ event }: { event: EventRow }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const summary =
    (event.payload.summary as string | undefined) ||
    (event.payload.thinking as string | undefined) ||
    `thinking…`
  return (
    <Text
      size="1"
      color="gray"
      style={{
        fontStyle: `italic`,
        opacity: open ? 1 : 0.7,
        borderLeft: `2px solid var(--gray-a5)`,
        paddingLeft: 12,
        cursor: `pointer`,
        userSelect: `none`,
      }}
      onClick={() => setOpen((o) => !o)}
    >
      {summary}
    </Text>
  )
}

function TurnAbortedRow({ event }: { event: EventRow }): React.ReactElement {
  const reason = event.payload.reason as string | undefined
  return (
    <Text size="1" color="gray" style={{ opacity: 0.6 }}>
      Turn aborted{reason ? ` — ${reason}` : ``}
    </Text>
  )
}

function PermissionRequestRow({
  event,
}: {
  event: EventRow
}): React.ReactElement {
  const tool = (event.payload.tool as string | undefined) ?? `tool`
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
  event: EventRow
}): React.ReactElement {
  const decision =
    (event.payload.decision as string | undefined) ??
    (event.payload.behavior as string | undefined) ??
    `responded`
  const user = event.payload.user as { name?: string } | undefined
  return (
    <Text size="2" color="gray" style={{ opacity: 0.7 }}>
      <strong>{user?.name ?? `user`}</strong> {decision}
    </Text>
  )
}

function ErrorRow({ event }: { event: EventRow }): React.ReactElement {
  const code =
    (event.payload.code as string | undefined) ??
    (event.payload.type as string | undefined) ??
    `error`
  const message =
    (event.payload.message as string | undefined) ??
    (event.payload.text as string | undefined) ??
    ``
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

function UnknownRow({ event }: { event: EventRow }): React.ReactElement {
  return (
    <Text size="1" color="gray" style={{ fontFamily: `var(--font-mono)` }}>
      [{event.type}]
    </Text>
  )
}
