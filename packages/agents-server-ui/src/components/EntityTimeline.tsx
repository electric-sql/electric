import {
  Component,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { eq, inArray } from '@durable-streams/state/db'
import {
  measureElement as defaultMeasureElement,
  useVirtualizer,
} from '@tanstack/react-virtual'
import {
  ArrowDown,
  CircleStop,
  Database,
  ExternalLink,
  FileJson,
  GitBranch,
  Radio,
} from 'lucide-react'
import {
  loadTimelineRowHeights,
  persistTimelineRowHeights,
} from '../lib/timelineRowHeights'
import { usePaneFindAdapterRegistration } from '../hooks/usePaneFind'
import { useOptionalWorkspace } from '../hooks/useWorkspace'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import {
  attachmentDisplayName,
  attachmentDownloadUrl,
  isAttachmentManifest,
} from '../lib/attachments'
import {
  resolveSandboxProfile,
  sandboxDisplayLabel,
} from '../lib/entityRuntime'
import { warmMarkdownRenderCache } from '../lib/markdownRenderCache'
import { useCurrentPrincipal } from '../hooks/useCurrentPrincipal'
import { Icon, IconButton, ScrollArea, Stack, Text, Tooltip } from '../ui'
import { UserMessage } from './UserMessage'
import type { ForkFromHereAction, UserMessageAttachment } from './UserMessage'
import { AgentResponseLive } from './AgentResponse'
import { InlineEventCard } from './InlineEventCard'
import { InlineStatusBadge } from './InlineStatusBadge'
import {
  getCurrentMatchIndexInRoot,
  getTextMatchStarts,
} from './workspace/PaneFindBar'
import {
  formatAbsoluteDateTimeVerbose,
  formatChatTimestamp,
} from '../lib/formatTime'
import styles from './EntityTimeline.module.css'
import type { ElectricUser } from '../lib/ElectricAgentsProvider'
import type {
  EntityTimelineSection,
  EntityTimelineQueryRow,
  EntityTimelineRunItem,
  EntityTimelineRunRow,
  IncludesEntity,
  Manifest,
} from '@electric-ax/agents-runtime/client'
import type { ErrorInfo, ReactNode } from 'react'
import type { PaneFindAdapter, PaneFindMatch } from '../hooks/usePaneFind'

type RenderTimelineRow = EntityTimelineQueryRow
type WakeSection = Extract<EntityTimelineSection, { kind: `wake` }>

function renderRowKey(row: RenderTimelineRow): string {
  return row.$key
}

function readInboxText(payload: unknown): string {
  if (payload && typeof payload === `object`) {
    const text = (payload as { text?: unknown }).text
    if (typeof text === `string`) return text
  }
  return typeof payload === `string` ? payload : ``
}

function stringifySearchPayload(value: unknown): string {
  if (value == null) return ``
  if (typeof value === `string`) return value
  return JSON.stringify(value)
}

function runItemSearchText(item: EntityTimelineRunItem): string {
  if (item.text) {
    return typeof item.text.content === `string` ? item.text.content : ``
  }
  const toolCall = item.toolCall
  if (!toolCall) {
    console.error(`Run item has neither text nor toolCall`, { item })
    return ``
  }
  return [
    toolCall.tool_name,
    stringifySearchPayload(toolCall.args),
    stringifySearchPayload(toolCall.result),
    stringifySearchPayload(toolCall.error),
  ]
    .filter((text) => text.length > 0)
    .join(` `)
}

function runSearchTextFromSnapshot(run: EntityTimelineRunRow): string {
  return run.items.toArray.map(runItemSearchText).join(` `)
}

interface TimelineRowErrorBoundaryProps {
  rowKey: string
  children: ReactNode
}

interface TimelineRowErrorBoundaryState {
  rowKey: string
  error: unknown
}

class TimelineRowErrorBoundary extends Component<
  TimelineRowErrorBoundaryProps,
  TimelineRowErrorBoundaryState
> {
  state: TimelineRowErrorBoundaryState = {
    rowKey: this.props.rowKey,
    error: null,
  }

  static getDerivedStateFromError(
    error: unknown
  ): Partial<TimelineRowErrorBoundaryState> {
    return { error }
  }

  static getDerivedStateFromProps(
    props: TimelineRowErrorBoundaryProps,
    state: TimelineRowErrorBoundaryState
  ): Partial<TimelineRowErrorBoundaryState> | null {
    if (props.rowKey !== state.rowKey) {
      return { rowKey: props.rowKey, error: null }
    }
    return null
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`Error rendering timeline row`, {
      rowKey: this.props.rowKey,
      error,
      componentStack: info.componentStack,
    })
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children
    }

    const message =
      this.state.error instanceof Error
        ? this.state.error.message
        : String(this.state.error)

    return (
      <Stack direction="column" gap={1}>
        <Text tone="danger" size={2}>
          Could not render this timeline row.
        </Text>
        <Text tone="muted" size={1}>
          {message}
        </Text>
      </Stack>
    )
  }
}

/**
 * Width-aware row-height estimate used as the initial size hint for the
 * virtualizer (before the real DOM has been measured). Producing an estimate
 * that's close to the eventual measured height matters because the
 * virtualizer absolutely-positions rows based on these values: when the
 * estimate is wildly off, rows visually overlap or leave gaps for a frame
 * before `ResizeObserver` catches up.
 *
 * The previous heuristic ignored the column width and used a flat
 * ~0.12 px/char ratio, which only happened to be roughly right at one
 * specific column width and was noticeably wrong on resize / chat swap.
 * We now derive an approximate chars-per-line from the actual column
 * width and multiply by the body line height.
 */
function estimateRowHeight(
  row: RenderTimelineRow | undefined,
  contentWidth: number
): number {
  if (!row) return 120

  // Inter at 14px averages ~7px per character; clamp to keep narrow
  // viewports / a yet-unknown contentWidth from producing nonsense values.
  const usableWidth = contentWidth > 0 ? contentWidth : 720
  const charsPerLine = Math.max(40, Math.floor(usableWidth / 7))
  const lineHeight = 22 // 14px font * ~1.55 leading

  if (row.inbox) {
    const lines = Math.max(
      1,
      Math.ceil(readInboxText(row.inbox.payload).length / charsPerLine)
    )
    return Math.max(64, 48 + lines * lineHeight) + timelineRowGap(row)
  }
  if (row.wake || row.signal || row.manifest) {
    return 76 + timelineRowGap(row)
  }
  return 120 + timelineRowGap(row)
}

const BOTTOM_PIN_THRESHOLD = 8
const CHAT_SURFACE_GUTTER = 24
const ROW_GAP = 24
const MANIFEST_ROW_GAP = 10
const ROW_SETTLE_MS = 500
type EntityStatus = NonNullable<IncludesEntity[`status`]>

function timelineRowGap(row: RenderTimelineRow): number {
  return row.manifest || row.wake || row.signal ? MANIFEST_ROW_GAP : ROW_GAP
}

type TimelinePaneFindMatch = PaneFindMatch & {
  rowKey: string
  rowIndex: number
  rowOccurrence: number
}

function timelineRowSearchText(
  row: RenderTimelineRow,
  runSearchTextByKey: Map<string, string>
): string {
  if (row.inbox) return readInboxText(row.inbox.payload)
  if (row.wake) {
    return wakeSectionText({
      kind: `wake`,
      payload: row.wake.payload,
      timestamp: Date.parse(row.wake.payload.timestamp),
    })
  }
  if (row.signal) return signalSearchText(row.signal)
  if (row.manifest) return manifestSearchText(row.manifest)
  return runSearchTextByKey.get(row.$key) ?? runSearchTextFromSnapshot(row.run)
}

function timelineRowLabel(row: RenderTimelineRow): string {
  if (row.inbox) return `User message`
  if (row.wake) return `Wake`
  if (row.signal) return `Signal`
  if (row.manifest) return `Manifest item`
  return `Agent response`
}

function firstSelfSendWakeChange(
  section: WakeSection,
  entityUrl?: string | null
): WakeSection[`payload`][`changes`][number] | null {
  if (!entityUrl || section.payload.source !== entityUrl) return null
  return (
    section.payload.changes.find((change) => change.collection === `inbox`) ??
    null
  )
}

function isSelfSendWake(
  section: WakeSection,
  entityUrl?: string | null
): boolean {
  return firstSelfSendWakeChange(section, entityUrl) !== null
}

function wakeSelfSendMessage(
  section: WakeSection,
  entityUrl?: string | null
): string | null {
  const change = firstSelfSendWakeChange(section, entityUrl)
  if (!change) return null
  const payload = change.payload
  if (payload == null) return ``
  return typeof payload === `string`
    ? payload
    : JSON.stringify(payload, null, 2)
}

function wakeReason(section: WakeSection, entityUrl?: string | null): string {
  const { payload } = section
  if (isSelfSendWake(section, entityUrl)) return `sent to itself`
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

function wakeSectionText(
  section: WakeSection,
  entityUrl?: string | null
): string {
  return [
    `woke`,
    wakeReason(section, entityUrl),
    section.payload.source,
    ...wakeDetails(section).map((detail) => `${detail.label} ${detail.value}`),
  ].join(` `)
}

function WakeTimelineRow({
  section,
  entityUrl,
}: {
  section: WakeSection
  entityUrl?: string | null
}): React.ReactElement {
  const reason = wakeReason(section, entityUrl)
  const details = wakeDetails(section, entityUrl)
  const childOutput = wakeChildOutput(section)
  const selfSendMessage = wakeSelfSendMessage(section, entityUrl)
  return (
    <div className={styles.manifestRow}>
      <InlineEventCard
        icon={Radio}
        title="woke"
        summary={`${reason} · ${formatChatTimestamp(section.timestamp)}`}
        defaultExpanded={false}
        headerSurface
      >
        <div className={styles.manifestDetails}>
          {details.map((detail) => (
            <div key={detail.label} className={styles.manifestDetail}>
              <span>{detail.label}</span>
              <strong>{detail.value}</strong>
            </div>
          ))}
        </div>
        {selfSendMessage ? (
          <pre className={styles.manifestJson}>{selfSendMessage}</pre>
        ) : null}
        {childOutput ? (
          <pre className={styles.manifestJson}>{childOutput.value}</pre>
        ) : null}
      </InlineEventCard>
    </div>
  )
}

function SignalTimelineRow({
  signal,
}: {
  signal: NonNullable<RenderTimelineRow[`signal`]>
}): React.ReactElement {
  return (
    <div className={styles.manifestRow}>
      <InlineEventCard
        icon={CircleStop}
        title={`signal ${signal.signal}`}
        summary={signalSummary(signal)}
        headerSurface
      />
    </div>
  )
}

function signalSearchText(
  signal: NonNullable<RenderTimelineRow[`signal`]>
): string {
  return [
    `signal`,
    signal.signal,
    signal.status,
    signal.sender,
    signal.reason,
    signal.outcome,
    signal.previous_state,
    signal.new_state,
  ]
    .filter(Boolean)
    .join(` `)
}

function signalSummary(
  signal: NonNullable<RenderTimelineRow[`signal`]>
): string {
  const timestamp = Date.parse(signal.timestamp)
  return [
    signal.status,
    signal.outcome,
    signal.reason,
    Number.isFinite(timestamp) ? formatChatTimestamp(timestamp) : null,
  ]
    .filter(Boolean)
    .join(` · `)
}

function wakeDetails(
  section: WakeSection,
  entityUrl?: string | null
): Array<{ label: string; value: string }> {
  const { payload } = section
  const selfSendChange = firstSelfSendWakeChange(section, entityUrl)
  const details = [
    { label: `Source`, value: payload.source },
    { label: `Trigger`, value: wakeReason(section, entityUrl) },
    { label: `Time`, value: formatAbsoluteDateTimeVerbose(section.timestamp) },
  ]

  if (selfSendChange) {
    details.push({
      label: `From`,
      value: selfSendChange.from ?? payload.source,
    })
    const message = wakeSelfSendMessage(section, entityUrl)
    if (message) {
      details.push({ label: `Message`, value: message })
    }
  }

  if (payload.changes.length > 0) {
    details.push({
      label: `Changes`,
      value: payload.changes
        .map((change) => `${change.kind} ${change.collection}:${change.key}`)
        .join(`, `),
    })
  }

  if (payload.finished_child) {
    const childOutput = wakeChildOutput(section)
    details.push(
      { label: `Child`, value: payload.finished_child.url },
      { label: `Child type`, value: payload.finished_child.type },
      { label: `Child status`, value: payload.finished_child.run_status }
    )
    if (childOutput) {
      details.push({
        label: childOutput.label,
        value: `${childOutput.value.length} chars`,
      })
    }
  }

  if (payload.other_children && payload.other_children.length > 0) {
    details.push({
      label: `Other children`,
      value: payload.other_children
        .map((child) => `${child.status} ${child.url}`)
        .join(`, `),
    })
  }

  return details.map((detail) => ({
    ...detail,
    value:
      detail.value.length > 120
        ? `${detail.value.slice(0, 117)}...`
        : detail.value,
  }))
}

function wakeChildOutput(
  section: WakeSection
): { label: string; value: string } | null {
  const child = section.payload.finished_child
  if (!child) return null
  if (child.error) return { label: `Child error`, value: child.error }
  if (child.response) return { label: `Child response`, value: child.response }
  return null
}

function excerptAround(
  text: string,
  start: number,
  queryLength: number
): string {
  const context = 48
  const from = Math.max(0, start - context)
  const to = Math.min(text.length, start + queryLength + context)
  const prefix = from > 0 ? `...` : ``
  const suffix = to < text.length ? `...` : ``
  return `${prefix}${text.slice(from, to).replace(/\s+/g, ` `)}${suffix}`
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function isTimelineFindMatch(
  match: PaneFindMatch
): match is TimelinePaneFindMatch {
  return (
    typeof (match as TimelinePaneFindMatch).rowKey === `string` &&
    typeof (match as TimelinePaneFindMatch).rowIndex === `number`
  )
}

function ManifestTimelineRow({
  manifest,
  entityUrl,
  entityStatus,
}: {
  manifest: Manifest
  entityUrl: string | null
  tileId: string | null
  entityStatus?: EntityStatus
}): React.ReactElement {
  const workspace = useOptionalWorkspace()
  const navigate = useNavigate()
  const entityTarget = getManifestEntityUrl(manifest)
  const stateSourceId = getManifestStateSourceId(manifest)
  const isEntity = entityTarget !== null
  const title = manifestTitle(manifest)
  const meta = manifestMeta(manifest)
  const summary =
    isEntity || stateSourceId
      ? title
      : [title, meta].filter(Boolean).join(` · `)

  const openEntity = useCallback(() => {
    if (!entityTarget) return
    if (workspace) {
      workspace.helpers.openEntity(entityTarget)
      return
    }
    navigate({
      to: `/entity/$`,
      params: { _splat: entityTarget.replace(/^\//, ``) },
    })
  }, [entityTarget, navigate, workspace])

  const openStateInspector = useCallback(() => {
    if (!entityUrl || !stateSourceId || !workspace) return
    workspace.helpers.openEntity(entityUrl, {
      viewId: `state-explorer`,
      viewParams: { source: stateSourceId },
    })
  }, [entityUrl, stateSourceId, workspace])

  const statusBadge = entityStatus ? (
    <InlineStatusBadge tone={statusTone(entityStatus)}>
      {entityStatus}
    </InlineStatusBadge>
  ) : null

  const openAction = stateSourceId ? (
    <Tooltip content="Open State Explorer">
      <IconButton
        type="button"
        size={1}
        variant="ghost"
        tone="neutral"
        className={styles.manifestActionButton}
        aria-label="Open State Explorer"
        onClick={openStateInspector}
        disabled={!entityUrl || !workspace}
      >
        <Icon icon={ExternalLink} size={1} />
      </IconButton>
    </Tooltip>
  ) : entityTarget ? (
    <Tooltip content="Open entity">
      <IconButton
        type="button"
        size={1}
        variant="ghost"
        tone="neutral"
        className={styles.manifestActionButton}
        aria-label="Open entity"
        onClick={openEntity}
      >
        <Icon icon={ExternalLink} size={1} />
      </IconButton>
    </Tooltip>
  ) : null
  const actions =
    statusBadge || openAction ? (
      <>
        {statusBadge}
        {openAction}
      </>
    ) : undefined

  const details = <ManifestDetailGrid manifest={manifest} />

  return (
    <div className={styles.manifestRow}>
      <InlineEventCard
        icon={manifestIcon(manifest)}
        title={manifestKindLabel(manifest)}
        summary={summary}
        actions={actions}
        collapsible={!isEntity && !stateSourceId}
        headerSurface
      >
        {isEntity || stateSourceId ? (
          details
        ) : (
          <>
            {details}
            <pre className={styles.manifestJson}>
              {JSON.stringify(manifest, null, 2)}
            </pre>
          </>
        )}
      </InlineEventCard>
    </div>
  )
}

function ManifestDetailGrid({
  manifest,
}: {
  manifest: Manifest
}): React.ReactElement | null {
  const details = manifestDetails(manifest)
  if (details.length === 0) return null
  return (
    <div className={styles.manifestDetails}>
      {details.map((detail) => (
        <div key={detail.label} className={styles.manifestDetail}>
          <span>{detail.label}</span>
          <strong>{detail.value}</strong>
        </div>
      ))}
    </div>
  )
}

function manifestSearchText(manifest: Manifest): string {
  return [
    manifestKindLabel(manifest),
    manifestTitle(manifest),
    manifestMeta(manifest),
  ]
    .filter(Boolean)
    .join(` `)
}

function manifestKindLabel(manifest: Manifest): string {
  switch (manifest.kind) {
    case `child`:
      return `Child entity`
    case `source`:
      return manifest.sourceType === `db`
        ? `Database source`
        : `${titleCase(manifest.sourceType)} source`
    case `shared-state`:
      return `Shared state`
    case `effect`:
      return `Effect`
    case `attachment`:
      return `Attachment`
    case `context`:
      return `Context`
    case `schedule`:
      return `Schedule`
  }
}

function manifestTitle(manifest: Manifest): string {
  switch (manifest.kind) {
    case `child`:
      return manifest.entity_url
    case `source`:
      return manifest.sourceRef
    case `shared-state`:
    case `effect`:
    case `attachment`:
    case `context`:
    case `schedule`:
      return manifest.id
  }
}

function manifestMeta(manifest: Manifest): string {
  switch (manifest.kind) {
    case `child`:
      return manifest.observed ? `child entity` : `child entity · unobserved`
    case `source`:
      return describeSourceConfig(manifest.config)
    case `shared-state`:
      return `${manifest.mode} · ${Object.keys(manifest.collections).join(`, `)}`
    case `effect`:
      return manifest.function_ref
    case `attachment`:
      return `${manifest.mimeType} · ${manifest.status}`
    case `context`:
      return `${Object.keys(manifest.attrs).length} attrs`
    case `schedule`:
      return manifest.scheduleType === `cron`
        ? `${manifest.expression}${manifest.timezone ? ` · ${manifest.timezone}` : ``}`
        : `${manifest.fireAt} · ${manifest.status}`
  }
}

function manifestDetails(
  manifest: Manifest
): Array<{ label: string; value: string }> {
  switch (manifest.kind) {
    case `child`:
      return [
        { label: `Path`, value: manifest.entity_url },
        {
          label: `Status`,
          value: manifest.observed ? `observed` : `unobserved`,
        },
      ]
    case `shared-state`:
      return [
        { label: `Mode`, value: manifest.mode },
        {
          label: `Collections`,
          value: Object.keys(manifest.collections).join(`, `) || `none`,
        },
      ]
    case `source`:
      return [
        { label: `Type`, value: manifest.sourceType },
        { label: `Ref`, value: manifest.sourceRef },
      ]
    case `effect`:
      return [
        { label: `Function`, value: manifest.function_ref },
        { label: `Config`, value: shortJson(manifest.config) },
      ]
    case `attachment`:
      return [
        { label: `File`, value: attachmentDisplayName(manifest) },
        { label: `MIME`, value: manifest.mimeType },
        {
          label: `Subject`,
          value: `${manifest.subject.type}:${manifest.subject.key}`,
        },
      ]
    case `context`:
      return [
        { label: `Name`, value: manifest.name },
        { label: `Content`, value: `${manifest.content.length} chars` },
      ]
    case `schedule`:
      return manifest.scheduleType === `cron`
        ? [
            { label: `Cron`, value: manifest.expression },
            { label: `Timezone`, value: manifest.timezone ?? `local` },
          ]
        : [
            { label: `Fire at`, value: manifest.fireAt },
            { label: `Target`, value: manifest.targetUrl },
            { label: `Status`, value: manifest.status ?? `pending` },
          ]
  }
}

function manifestIcon(manifest: Manifest) {
  if (getManifestStateSourceId(manifest)) return Database
  if (getManifestEntityUrl(manifest)) return GitBranch
  if (manifest.kind === `schedule`) return Radio
  if (manifest.kind === `attachment`) return FileJson
  return FileJson
}

function getManifestEntityUrl(manifest: Manifest): string | null {
  if (manifest.kind === `child`) return manifest.entity_url
  if (manifest.kind === `source` && manifest.sourceType === `entity`) {
    return manifest.sourceRef
  }
  return null
}

function getManifestStateSourceId(manifest: Manifest): string | null {
  if (manifest.kind === `shared-state`) return manifest.id
  if (manifest.kind === `source` && manifest.sourceType === `db`) {
    return manifest.sourceRef
  }
  return null
}

function statusTone(status: EntityStatus) {
  switch (status) {
    case `idle`:
      return `success`
    case `spawning`:
    case `paused`:
    case `stopping`:
      return `warning`
    case `running`:
      return `info`
    case `stopped`:
      return `neutral`
    case `killed`:
      return `danger`
    default:
      return `neutral`
  }
}

function describeSourceConfig(config: Record<string, unknown>): string {
  const cache = typeof config.cache === `string` ? config.cache : null
  const keys = Object.keys(config).filter((key) => key !== `cache`)
  return [cache, keys.length > 0 ? `${keys.length} config keys` : null]
    .filter(Boolean)
    .join(` · `)
}

function shortJson(value: unknown): string {
  const json = JSON.stringify(value)
  return json.length > 80 ? `${json.slice(0, 77)}...` : json
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(` `)
}

function stableEntityUrlKey(urls: Iterable<string>): string {
  return Array.from(new Set(urls)).sort().join(`\0`)
}

function entityUrlsFromKey(key: string): Array<string> {
  return key.length === 0 ? [] : key.split(`\0`)
}

const TimelineRow = memo(function TimelineRow({
  row,
  responseTimestamp,
  isInitialUserMessage,
  entityStopped,
  isStreaming,
  renderWidth,
  entityUrl,
  tileId,
  attachmentsByInboxKey,
  entityStatusByUrl,
  currentPrincipal,
  usersById,
  stopUserMessageKey,
  stopPending,
  onStopGeneration,
  onForkFromHere,
  onRunSearchTextChange,
}: {
  row: RenderTimelineRow
  responseTimestamp: number | null
  isInitialUserMessage: boolean
  entityStopped: boolean
  isStreaming: boolean
  renderWidth: number
  entityUrl: string | null
  tileId: string | null
  attachmentsByInboxKey: Map<string, Array<UserMessageAttachment>>
  entityStatusByUrl: Map<string, EntityStatus>
  currentPrincipal: string
  usersById: Map<string, ElectricUser>
  stopUserMessageKey: string | null
  stopPending: boolean
  onStopGeneration?: () => void
  /** When set on a user-message row, enables the "Fork from here" hover
   * button. Caller pre-resolved the pointer; we just invoke. */
  onForkFromHere?: ForkFromHereAction
  onRunSearchTextChange: (rowKey: string, text: string) => void
}): React.ReactElement {
  if (row.inbox) {
    const timestamp = Date.parse(row.inbox.timestamp)
    return (
      <UserMessage
        section={{
          kind: `user_message`,
          from: row.inbox.from,
          text: readInboxText(row.inbox.payload),
          timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
          isInitial: isInitialUserMessage,
        }}
        attachments={attachmentsByInboxKey.get(row.inbox.key)}
        currentPrincipal={currentPrincipal}
        usersById={usersById}
        showStop={
          stopUserMessageKey !== null && row.$key === stopUserMessageKey
        }
        stopPending={stopPending}
        onStop={onStopGeneration}
        forkFromHere={onForkFromHere}
      />
    )
  }

  if (row.wake) {
    return (
      <WakeTimelineRow
        section={{
          kind: `wake`,
          payload: row.wake.payload,
          timestamp: Date.parse(row.wake.payload.timestamp),
        }}
        entityUrl={entityUrl}
      />
    )
  }

  if (row.signal) {
    return <SignalTimelineRow signal={row.signal} />
  }

  if (row.manifest) {
    return (
      <ManifestTimelineRow
        manifest={row.manifest}
        entityUrl={entityUrl}
        tileId={tileId}
        entityStatus={
          getManifestEntityUrl(row.manifest)
            ? entityStatusByUrl.get(getManifestEntityUrl(row.manifest)!)
            : undefined
        }
      />
    )
  }

  return (
    <AgentResponseLive
      rowKey={row.$key}
      run={row.run}
      isStreaming={!entityStopped && isStreaming}
      timestamp={responseTimestamp}
      renderWidth={renderWidth}
      onSearchTextChange={onRunSearchTextChange}
    />
  )
})

export function EntityTimeline({
  rows,
  loading,
  error,
  entityStopped,
  baseUrl,
  cacheKey,
  tileId,
  entityUrl = null,
  entities = [],
  scrollToBottomSignal = 0,
  stopPending = false,
  onStopGeneration,
  forkFromHereByInboxKey,
}: {
  rows: Array<EntityTimelineQueryRow>
  loading: boolean
  error: string | null
  entityStopped: boolean
  baseUrl: string
  cacheKey?: string | null
  tileId?: string | null
  entityUrl?: string | null
  entities?: Array<IncludesEntity>
  scrollToBottomSignal?: number
  stopPending?: boolean
  onStopGeneration?: () => void
  /**
   * Per-inbox-row click handlers for the "Fork from here" hover button.
   * The map is keyed by the row's `$key`; rows not in the map (or when
   * the prop is omitted) get no fork affordance. The caller resolves
   * the fork pointer and runs the fork → navigate flow.
   */
  forkFromHereByInboxKey?: Map<string, ForkFromHereAction>
}): React.ReactElement {
  const { entitiesCollection, runnersCollection, usersCollection } =
    useElectricAgents()
  const referencedEntityUrlKey = useMemo(
    () => stableEntityUrlKey(entities.map((entity) => entity.url)),
    [entities]
  )
  const referencedEntityUrls = useMemo(
    () => entityUrlsFromKey(referencedEntityUrlKey),
    [referencedEntityUrlKey]
  )
  const { data: entityStatuses = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection || referencedEntityUrls.length === 0) {
        return undefined
      }
      return q
        .from({ e: entitiesCollection as any })
        .where(({ e }: any) => inArray(e.url, referencedEntityUrls))
        .select(({ e }: any) => ({
          url: e.url,
          status: e.status,
        }))
    },
    [entitiesCollection, referencedEntityUrlKey]
  )
  // Pull the sandbox profile name for the currently-focused entity so
  // we can surface it as a read-only badge next to the spawned marker.
  // The sandbox choice is set at spawn time and immutable for the
  // entity's lifetime, so a single read here is sufficient.
  const { data: focusedEntity = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection || !entityUrl) return undefined
      return q
        .from({ e: entitiesCollection as any })
        .where(({ e }: any) => eq(e.url, entityUrl))
        .select(({ e }: any) => ({ sandbox: e.sandbox }))
    },
    [entitiesCollection, entityUrl]
  )
  const sandboxProfileName = focusedEntity[0]?.sandbox?.profile ?? null
  // Resolve the profile's advertised label (e.g. "Docker") rather than the raw
  // profile name, matching how the header/sidebar badges render it.
  const { data: runners = [] } = useLiveQuery(
    (q) => {
      if (!runnersCollection) return undefined
      return q.from({ r: runnersCollection })
    },
    [runnersCollection]
  )
  const { data: users = [] } = useLiveQuery(
    (q) => {
      if (!usersCollection) return undefined
      return q.from({ user: usersCollection })
    },
    [usersCollection]
  )
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users]
  )
  const { principal: currentPrincipal } = useCurrentPrincipal()
  const sandboxLabel = sandboxProfileName
    ? (sandboxDisplayLabel(
        resolveSandboxProfile(runners, sandboxProfileName),
        sandboxProfileName
      ) ?? sandboxProfileName)
    : null
  const entityStatusByUrl = useMemo(() => {
    const statusByUrl = new Map<string, EntityStatus>()
    for (const entity of entities) {
      if (entity.status) statusByUrl.set(entity.url, entity.status)
    }
    for (const entity of entityStatuses) {
      statusByUrl.set(entity.url, entity.status)
    }
    return statusByUrl
  }, [entities, entityStatuses])
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(
    null
  )
  const [viewportWidth, setViewportWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const isNearBottom = useRef(true)
  const lastScrollTopRef = useRef(0)
  const spawnMarkerRef = useRef<HTMLSpanElement | null>(null)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const [showTopDivider, setShowTopDivider] = useState(false)
  const [runSearchTextByKey, setRunSearchTextByKey] = useState(
    () => new Map<string, string>()
  )
  const cachedSizeMapRef = useRef(new Map<string, number>())
  const lastMeasureAtRef = useRef(new Map<string, number>())
  const settledKeysRef = useRef(new Set<string>())
  const settleCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handledScrollSignalRef = useRef(scrollToBottomSignal)
  const previousStreamingAgentKeyRef = useRef<string | null>(null)
  const textColumnWidth = Math.max(0, contentWidth - CHAT_SURFACE_GUTTER)
  const displayRows = useMemo(
    () => rows.filter((row) => !isAttachmentManifest(row.manifest)),
    [rows]
  )
  const attachmentsByInboxKey = useMemo(() => {
    const byKey = new Map<string, Array<UserMessageAttachment>>()
    if (!entityUrl) return byKey
    for (const row of rows) {
      const manifest = row.manifest
      if (
        !isAttachmentManifest(manifest) ||
        manifest.subject.type !== `inbox`
      ) {
        continue
      }
      const entry: UserMessageAttachment = {
        id: manifest.id,
        name: attachmentDisplayName(manifest),
        mimeType: manifest.mimeType,
        byteLength: manifest.byteLength,
        status: manifest.status,
        url: attachmentDownloadUrl(baseUrl, entityUrl, manifest.id),
      }
      const existing = byKey.get(manifest.subject.key) ?? []
      existing.push(entry)
      byKey.set(manifest.subject.key, existing)
    }
    return byKey
  }, [baseUrl, entityUrl, rows])

  const spawnTime = useMemo(() => {
    for (const row of displayRows) {
      if (!row.inbox) continue
      const timestamp = Date.parse(row.inbox.timestamp)
      return Number.isFinite(timestamp) ? timestamp : null
    }
    return null
  }, [displayRows])

  const lastStreamingAgentKey = useMemo(() => {
    for (let index = displayRows.length - 1; index >= 0; index--) {
      const row = displayRows[index]
      if (row.run) {
        return row.run.status === `started` ? row.$key : null
      }
    }
    return null
  }, [displayRows])

  const stopUserMessageKey = useMemo(() => {
    if (!lastStreamingAgentKey) return null
    const streamingIndex = displayRows.findIndex(
      (row) => row.$key === lastStreamingAgentKey
    )
    if (streamingIndex < 0) return null
    for (let index = streamingIndex - 1; index >= 0; index--) {
      const row = displayRows[index]
      if (row?.inbox) {
        return row.$key
      }
    }
    return null
  }, [displayRows, lastStreamingAgentKey])
  const firstInboxRowKey = useMemo(
    () => displayRows.find((row) => row.inbox)?.$key ?? null,
    [displayRows]
  )
  const responseTimestampByRowKey = useMemo(() => {
    const timestampByRowKey = new Map<string, number | null>()
    let lastUserTimestamp: number | null = null
    for (const row of displayRows) {
      if (row.inbox) {
        const timestamp = Date.parse(row.inbox.timestamp)
        lastUserTimestamp = Number.isFinite(timestamp) ? timestamp : null
      } else if (row.run) {
        timestampByRowKey.set(row.$key, lastUserTimestamp)
      }
    }
    return timestampByRowKey
  }, [displayRows])
  const updateRunSearchText = useCallback((rowKey: string, text: string) => {
    setRunSearchTextByKey((current) => {
      if (text.length === 0) {
        if (!current.has(rowKey)) return current
        const next = new Map(current)
        next.delete(rowKey)
        return next
      }
      if (current.get(rowKey) === text) return current
      const next = new Map(current)
      next.set(rowKey, text)
      return next
    })
  }, [])

  const persistSettledRows = useCallback(() => {
    if (!cacheKey || viewportWidth <= 0) return
    persistTimelineRowHeights(
      cacheKey,
      viewportWidth,
      cachedSizeMapRef.current,
      settledKeysRef.current
    )
  }, [cacheKey, viewportWidth])

  const scheduleSettleCheck = useCallback(() => {
    if (settleCheckTimerRef.current !== null) {
      clearTimeout(settleCheckTimerRef.current)
    }

    settleCheckTimerRef.current = setTimeout(() => {
      settleCheckTimerRef.current = null
      const now = Date.now()
      let anyNewlySettled = false

      for (const [key, lastMeasureAt] of lastMeasureAtRef.current) {
        if (settledKeysRef.current.has(key)) continue
        if (now - lastMeasureAt < ROW_SETTLE_MS) continue
        settledKeysRef.current.add(key)
        anyNewlySettled = true
      }

      if (anyNewlySettled) {
        persistSettledRows()
      }
    }, ROW_SETTLE_MS)
  }, [persistSettledRows])

  const measureRowElement = useCallback<
    NonNullable<
      Parameters<
        typeof useVirtualizer<HTMLDivElement, HTMLDivElement>
      >[0][`measureElement`]
    >
  >(
    (element, entry, instance) => {
      const itemKey = element.getAttribute(`data-item-key`)
      const domSize = defaultMeasureElement(element, entry, instance)

      // A real, non-zero measurement is the source of truth: cache it and
      // surface it to the virtualizer. A zero (e.g. element detached, not
      // yet laid out) must not poison the cache or replace a known good
      // size — fall back to whatever we already had.
      if (itemKey !== null && domSize > 0) {
        cachedSizeMapRef.current.set(itemKey, domSize)
        lastMeasureAtRef.current.set(itemKey, Date.now())
        settledKeysRef.current.delete(itemKey)
        scheduleSettleCheck()
        return domSize
      }

      if (itemKey !== null) {
        const cached = cachedSizeMapRef.current.get(itemKey)
        if (cached !== undefined && cached > 0) return cached
      }
      return domSize
    },
    [scheduleSettleCheck]
  )

  const rowVirtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => viewport,
    estimateSize: (index) =>
      cachedSizeMapRef.current.get(
        displayRows[index] ? renderRowKey(displayRows[index]!) : ``
      ) ?? estimateRowHeight(displayRows[index], textColumnWidth),
    getItemKey: (index) =>
      displayRows[index] ? renderRowKey(displayRows[index]!) : index,
    gap: 0,
    overscan: 6,
    measureElement: measureRowElement,
    enabled: displayRows.length > 0,
  })

  const paneFindAdapter = useMemo<PaneFindAdapter>(() => {
    const getHighlightRoot = (match: PaneFindMatch): HTMLElement | null => {
      if (!contentElement || !isTimelineFindMatch(match)) return null
      return contentElement.querySelector<HTMLElement>(
        `[data-pane-find-row-key="${CSS.escape(match.rowKey)}"]`
      )
    }

    return {
      search(query) {
        const matches: Array<TimelinePaneFindMatch> = []
        if (!query.trim()) return matches

        displayRows.forEach((row, rowIndex) => {
          const rowKey = renderRowKey(row)
          const text = timelineRowSearchText(row, runSearchTextByKey)
          const starts = getTextMatchStarts(text, query)
          starts.forEach((start, rowOccurrence) => {
            matches.push({
              id: `${rowKey}:${rowOccurrence}`,
              rowKey,
              rowIndex,
              rowOccurrence,
              label: timelineRowLabel(row),
              excerpt: excerptAround(text, start, query.length),
            })
          })
        })
        return matches
      },
      async reveal(match) {
        if (!isTimelineFindMatch(match)) return
        rowVirtualizer.scrollToIndex(match.rowIndex, { align: `center` })
        for (let i = 0; i < 8; i++) {
          await nextFrame()
          if (getHighlightRoot(match)) return
        }
      },
      getHighlightRoot,
      getCurrentMatchIndex(match, query) {
        if (!isTimelineFindMatch(match)) return 0
        const root = getHighlightRoot(match)
        if (!root) return 0
        return getCurrentMatchIndexInRoot(root, query, match)
      },
    }
  }, [contentElement, displayRows, rowVirtualizer, runSearchTextByKey])

  usePaneFindAdapterRegistration(tileId ?? null, paneFindAdapter)

  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false
  }, [rowVirtualizer])

  const scrollToTimelineEnd = useCallback(
    (opts?: { force?: boolean }) => {
      if (!viewport || displayRows.length === 0) return
      const force = opts?.force ?? false
      rowVirtualizer.scrollToIndex(displayRows.length - 1, { align: `end` })

      // The stopped/status footer sits outside the virtual list, so make sure the
      // physical scroll container is also flush with its full content height.
      requestAnimationFrame(() => {
        if (!force && !isNearBottom.current) return
        viewport.scrollTop = viewport.scrollHeight
      })
    },
    [displayRows.length, rowVirtualizer, viewport]
  )

  const scrollAreaRef = useCallback((node: HTMLDivElement | null) => {
    setViewport(node)
  }, [])

  const contentRef = useCallback((node: HTMLDivElement | null) => {
    setContentElement(node)
  }, [])

  useEffect(() => {
    void warmMarkdownRenderCache()
  }, [])

  useEffect(() => {
    if (!viewport) return

    const updateViewportWidth = () => {
      const w = Math.round(viewport.clientWidth)
      setViewportWidth((prev) => {
        if (prev !== w && prev > 0) {
          // Container resized (e.g. state explorer toggled, window resize) —
          // mark all rows as un-settled so we'll persist new heights once
          // ResizeObserver remeasures them at the new width. Crucially we
          // KEEP the prior heights as estimates so the virtualizer's
          // initial layout at the new width stays close to truth; rows
          // would otherwise visually overlap while they remeasure.
          settledKeysRef.current = new Set()
        }
        return w
      })
    }

    updateViewportWidth()
    const observer = new ResizeObserver(updateViewportWidth)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewport])

  useEffect(() => {
    if (!contentElement) return

    const updateContentWidth = () => {
      setContentWidth(Math.round(contentElement.clientWidth))
    }

    updateContentWidth()
    const observer = new ResizeObserver(updateContentWidth)
    observer.observe(contentElement)
    return () => observer.disconnect()
  }, [contentElement])

  // Track cacheKey/viewportWidth across renders so the effect below can tell
  // a chat swap apart from a width change. They have very different reset
  // semantics: a chat swap throws away all known row sizes (different
  // entries with different keys), while a width change wants to PRESERVE
  // the old heights as estimates so the layout stays put while
  // ResizeObserver remeasures at the new width.
  const prevCacheKeyRef = useRef<string | null | undefined>(undefined)
  const prevViewportWidthRef = useRef(0)

  useEffect(() => {
    const isChatSwap = prevCacheKeyRef.current !== cacheKey
    const widthChanged = prevViewportWidthRef.current !== viewportWidth
    prevCacheKeyRef.current = cacheKey
    prevViewportWidthRef.current = viewportWidth

    if (!cacheKey || viewportWidth <= 0) {
      if (isChatSwap) {
        cachedSizeMapRef.current = new Map()
        settledKeysRef.current = new Set()
        lastMeasureAtRef.current = new Map()
        rowVirtualizer.measure()
      }
      return
    }

    if (isChatSwap) {
      // Different chat → different row keys. Reload heights from
      // localStorage and invalidate the virtualizer's internal item-size
      // cache so it consults `estimateSize` for every new key.
      const restored = loadTimelineRowHeights(cacheKey, viewportWidth)
      cachedSizeMapRef.current = restored
      settledKeysRef.current = new Set(restored.keys())
      lastMeasureAtRef.current = new Map()
      rowVirtualizer.measure()
      return
    }

    if (widthChanged) {
      // Same chat, new viewport width. Pull in any heights we previously
      // persisted at this width as updated estimates, but DO NOT call
      // `rowVirtualizer.measure()` here: the existing rows are still
      // mounted and ResizeObserver will deliver fresh measurements as
      // they reflow. Calling `measure()` would throw away the
      // virtualizer's internal cache between ResizeObserver firing and
      // our re-render, producing the visible row-overlap glitch.
      const restored = loadTimelineRowHeights(cacheKey, viewportWidth)
      if (restored.size > 0) {
        for (const [key, size] of restored) {
          cachedSizeMapRef.current.set(key, size)
        }
        for (const key of restored.keys()) settledKeysRef.current.add(key)
      }
    }
  }, [cacheKey, rowVirtualizer, viewportWidth])

  useEffect(() => {
    if (!viewport) return

    const detachFromBottom = () => {
      isNearBottom.current = false
      setShowJumpToBottom(true)
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && viewport.scrollTop > 0) {
        detachFromBottom()
      }
    }

    const handleScroll = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      const scrollingUp = viewport.scrollTop < lastScrollTopRef.current - 1
      const pinnedToBottom = distanceFromBottom <= BOTTOM_PIN_THRESHOLD

      if (scrollingUp && !pinnedToBottom) {
        detachFromBottom()
      } else if (pinnedToBottom) {
        isNearBottom.current = true
      }

      lastScrollTopRef.current = viewport.scrollTop
      const spawnMarker = spawnMarkerRef.current
      if (spawnMarker) {
        const markerRect = spawnMarker.getBoundingClientRect()
        const viewportRect = viewport.getBoundingClientRect()
        setShowTopDivider(markerRect.top <= viewportRect.top)
      } else {
        setShowTopDivider(false)
      }
      setShowJumpToBottom(!isNearBottom.current)
    }

    handleScroll()
    viewport.addEventListener(`wheel`, handleWheel, { passive: true })
    viewport.addEventListener(`scroll`, handleScroll, { passive: true })
    return () => {
      viewport.removeEventListener(`wheel`, handleWheel)
      viewport.removeEventListener(`scroll`, handleScroll)
    }
  }, [viewport])

  useLayoutEffect(() => {
    if (!viewport || displayRows.length === 0) return
    if (!isNearBottom.current) return

    const frame = requestAnimationFrame(() => {
      scrollToTimelineEnd()
    })

    return () => cancelAnimationFrame(frame)
  }, [displayRows, scrollToTimelineEnd, viewport])

  useLayoutEffect(() => {
    if (!contentElement || !viewport) return

    let frame: ReturnType<typeof requestAnimationFrame> | null = null
    const pinToBottom = () => {
      if (!isNearBottom.current) return
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        scrollToTimelineEnd()
      })
    }

    const observer = new ResizeObserver(pinToBottom)
    observer.observe(contentElement)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [contentElement, scrollToTimelineEnd, viewport])

  useLayoutEffect(() => {
    const previousStreamingAgentKey = previousStreamingAgentKeyRef.current
    previousStreamingAgentKeyRef.current = lastStreamingAgentKey
    if (!previousStreamingAgentKey || lastStreamingAgentKey) return
    if (!isNearBottom.current) return

    setShowJumpToBottom(false)
    const frame = requestAnimationFrame(() => {
      scrollToTimelineEnd()
    })

    return () => cancelAnimationFrame(frame)
  }, [lastStreamingAgentKey, scrollToTimelineEnd])

  useLayoutEffect(() => {
    if (handledScrollSignalRef.current === scrollToBottomSignal) return
    handledScrollSignalRef.current = scrollToBottomSignal
    isNearBottom.current = true
    setShowJumpToBottom(false)

    if (!viewport || displayRows.length === 0) return
    const frame = requestAnimationFrame(() => {
      scrollToTimelineEnd({ force: true })
    })

    return () => cancelAnimationFrame(frame)
  }, [displayRows.length, scrollToBottomSignal, scrollToTimelineEnd, viewport])

  useEffect(
    () => () => {
      if (settleCheckTimerRef.current !== null) {
        clearTimeout(settleCheckTimerRef.current)
      }
    },
    []
  )

  const jumpToBottom = useCallback(() => {
    if (displayRows.length > 0) {
      isNearBottom.current = true
      setShowJumpToBottom(false)
      scrollToTimelineEnd({ force: true })
    }
  }, [displayRows.length, scrollToTimelineEnd])

  if (loading) {
    return (
      <Stack align="center" justify="center" grow>
        <Text tone="muted" size={2}>
          Connecting to stream...
        </Text>
      </Stack>
    )
  }

  if (error) {
    return (
      <Stack align="center" justify="center" grow>
        <Text tone="danger" size={2}>
          {error}
        </Text>
      </Stack>
    )
  }

  return (
    <div className={styles.root} data-desktop-selection-context="">
      <div
        className={styles.topDivider}
        data-visible={showTopDivider ? `true` : undefined}
        aria-hidden="true"
      />
      <ScrollArea
        viewportRef={scrollAreaRef}
        className={styles.scroll}
        viewportClassName={`${styles.scrollViewport} mobile-chat-scroll-viewport`}
        scrollbars="vertical"
      >
        <div
          ref={contentRef}
          className={`${styles.content} mobile-chat-content`}
        >
          <Stack gap={2} direction="row">
            {spawnTime ? (
              <Tooltip content={formatAbsoluteDateTimeVerbose(spawnTime)}>
                <span ref={spawnMarkerRef} className={styles.statusPill}>
                  <Text size={1} tone="muted" className={styles.statusText}>
                    spawned
                  </Text>
                  <Text size={1} tone="muted" className={styles.statusText}>
                    ·
                  </Text>
                  <Text size={1} tone="muted" className={styles.statusText}>
                    {formatChatTimestamp(spawnTime)}
                  </Text>
                </span>
              </Tooltip>
            ) : (
              <span ref={spawnMarkerRef} className={styles.statusPill}>
                <Text size={1} tone="muted" className={styles.statusText}>
                  spawned
                </Text>
              </span>
            )}
            {sandboxLabel && (
              <Tooltip content={`Sandbox: ${sandboxLabel}`}>
                <span className={styles.statusPill}>
                  <Text size={1} tone="muted" className={styles.statusText}>
                    {`sandbox · ${sandboxLabel}`}
                  </Text>
                </span>
              </Tooltip>
            )}
          </Stack>

          {displayRows.length === 0 ? (
            <Stack justify="center" py={6}>
              <Text tone="muted" size={2} className={styles.emptyState}>
                Waiting for events...
              </Text>
            </Stack>
          ) : (
            <div
              className={styles.virtualList}
              style={{
                height: rowVirtualizer.getTotalSize(),
                marginTop: ROW_GAP,
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = displayRows[virtualRow.index]
                const rowKey = renderRowKey(row)

                // Stable row key. The previous implementation appended
                // `:${contentWidth}` to force remount on every column-width
                // change, which paid for the workaround with a full
                // unmount/remount of every row (including a wasted Streamdown
                // render on initial mount when contentWidth went from 0 to
                // its real value). The new measurement-cache logic above
                // preserves prior heights as estimates and lets
                // ResizeObserver deliver new heights, so a remount is no
                // longer needed.
                return (
                  <div
                    key={virtualRow.key}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    data-item-key={rowKey}
                    data-pane-find-row-key={rowKey}
                    className={styles.virtualRow}
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                      paddingBottom: timelineRowGap(row),
                    }}
                  >
                    <TimelineRowErrorBoundary rowKey={rowKey}>
                      <TimelineRow
                        row={row}
                        responseTimestamp={
                          responseTimestampByRowKey.get(rowKey) ?? null
                        }
                        isInitialUserMessage={rowKey === firstInboxRowKey}
                        entityStopped={entityStopped}
                        isStreaming={rowKey === lastStreamingAgentKey}
                        renderWidth={textColumnWidth}
                        entityUrl={entityUrl}
                        tileId={tileId ?? null}
                        attachmentsByInboxKey={attachmentsByInboxKey}
                        entityStatusByUrl={entityStatusByUrl}
                        currentPrincipal={currentPrincipal}
                        usersById={usersById}
                        stopUserMessageKey={stopUserMessageKey}
                        stopPending={stopPending}
                        onStopGeneration={onStopGeneration}
                        onForkFromHere={forkFromHereByInboxKey?.get(rowKey)}
                        onRunSearchTextChange={updateRunSearchText}
                      />
                    </TimelineRowErrorBoundary>
                  </div>
                )
              })}
            </div>
          )}

          {entityStopped && (
            <Stack style={{ marginTop: ROW_GAP }}>
              <Text size={1} tone="muted" className={styles.statusPill}>
                stopped
              </Text>
            </Stack>
          )}
        </div>
      </ScrollArea>

      <button
        type="button"
        className={styles.jumpToBottom}
        data-visible={showJumpToBottom ? `true` : undefined}
        onClick={jumpToBottom}
        aria-label="Jump to latest"
        aria-hidden={!showJumpToBottom}
        tabIndex={showJumpToBottom ? 0 : -1}
      >
        <Icon icon={ArrowDown} size={3} />
      </button>
    </div>
  )
}
