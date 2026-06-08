import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import {
  streamdownComponents,
  streamdownControls,
  streamdownPlugins,
} from '../lib/streamdownConfig'
import { Stack, Text } from '../ui'
import { ThinkingIndicator } from './ThinkingIndicator'
import { ElapsedTime } from './ElapsedTime'
import { formatElapsedDuration, toMillis } from '../lib/formatTime'
import styles from './ReasoningSection.module.css'

/**
 * One reasoning row's worth of UI state — what the live query gives us
 * for each row in `run.reasoning`. Mirrors `EntityTimelineReasoningItem`
 * but pulled into a local type so the component file doesn't import
 * from agents-runtime/client (keeps this file dep-light for the desktop
 * + mobile embeds).
 */
export type ReasoningEntry = {
  key: string
  content: string
  status: `streaming` | `completed`
  summary_title?: string
  encrypted?: string
}

/**
 * Renders the model's extended-thinking / reasoning content above the
 * agent's visible response. Visual treatment intentionally mirrors
 * Claude Code + OpenCode:
 *
 * - **While streaming**: faded markdown body with the `ThinkingIndicator`
 *   shimmer + the parsed `summary_title` (if any) as the heading. The
 *   elapsed-time ticker rides alongside so the user sees the model is
 *   actively chewing on the problem.
 * - **Once settled**: collapses to a single-line `▸ Thought for 12s`
 *   row that the user can click to expand. Collapsed-by-default is the
 *   established pattern (OpenCode defaults to `hide` — reasoning is
 *   noise unless you're debugging).
 * - **Anthropic redacted blocks** (`encrypted` set, no `content`): the
 *   provider has hidden the content behind a safety filter. We can't
 *   show anything meaningful, so render a single-line affordance and
 *   move on. The encrypted payload is still persisted server-side so
 *   the model gets it back on the next turn.
 *
 * Multiple reasoning rows per run are possible — typically one per LLM
 * step in a tool-using turn — so we render each independently with its
 * own collapse state, in order.
 */
export function ReasoningSection({
  entries,
  isStreaming,
  timestamp,
}: {
  entries: Array<ReasoningEntry>
  isStreaming: boolean
  timestamp?: number | null
}): React.ReactElement | null {
  // Owned here rather than inside `ReasoningEntryView` so the user's
  // expand/collapse choice survives the entry view being unmounted and
  // remounted — e.g. when the reasoning row briefly disappears from
  // the live query while another part of the run updates, or when a
  // virtualizer measurement pass replaces the subtree.
  const [expandedByKey, setExpandedByKey] = useState<Record<string, boolean>>(
    {}
  )
  const toggleExpanded = useCallback((key: string) => {
    setExpandedByKey((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  if (entries.length === 0) return null
  return (
    <Stack direction="column" gap={2} className={styles.root}>
      {entries.map((entry) => (
        <ReasoningEntryView
          key={entry.key}
          entry={entry}
          isStreaming={isStreaming}
          timestamp={timestamp}
          expanded={Boolean(expandedByKey[entry.key])}
          onToggle={toggleExpanded}
        />
      ))}
    </Stack>
  )
}

function ReasoningEntryView({
  entry,
  isStreaming,
  timestamp,
  expanded,
  onToggle,
}: {
  entry: ReasoningEntry
  isStreaming: boolean
  timestamp?: number | null
  expanded: boolean
  onToggle: (key: string) => void
}): React.ReactElement {
  const isLive = isStreaming && entry.status === `streaming`
  const handleToggle = useMemo(
    () => () => onToggle(entry.key),
    [entry.key, onToggle]
  )

  // Snapshot the elapsed duration at the moment streaming flips to
  // `completed`, the same `sawStreamingRef` trick used for "done in
  // Xs" on `AgentResponse`. For reasoning rows that were already
  // settled on first mount (page reload, scrollback into older
  // turns) we don't have a real end timestamp, so the closure stays
  // a bare "Thought" without a duration — better than printing a
  // wildly-wrong number from `now() - userMessageTime`.
  const sawStreamingRef = useRef<boolean>(isLive)
  if (isLive) sawStreamingRef.current = true
  const [finalDurationMs, setFinalDurationMs] = useState<number | null>(null)
  useEffect(() => {
    if (
      entry.status === `completed` &&
      sawStreamingRef.current &&
      timestamp != null &&
      finalDurationMs == null
    ) {
      setFinalDurationMs(Math.max(0, Date.now() - toMillis(timestamp)))
    }
  }, [entry.status, timestamp, finalDurationMs])

  // Redacted thinking — opaque payload, nothing to render.
  if (entry.encrypted && entry.content.trim().length === 0) {
    return (
      <div className={styles.redacted}>
        <Text size={1} tone="muted">
          ⊘ Reasoning redacted by provider safety filters
        </Text>
      </div>
    )
  }

  if (isLive) {
    return (
      <div className={styles.live}>
        <Stack align="center" gap={2} className={styles.header}>
          <ThinkingIndicator />
          {entry.summary_title && (
            <>
              <Text size={1} tone="muted" className={styles.separator}>
                ·
              </Text>
              <Text size={1} tone="muted" className={styles.title}>
                {entry.summary_title}
              </Text>
            </>
          )}
          {timestamp != null && (
            <>
              <Text size={1} tone="muted" className={styles.separator}>
                ·
              </Text>
              <ElapsedTime ts={timestamp} enabled={isLive} />
            </>
          )}
        </Stack>
        <div className={styles.body}>
          <Streamdown
            isAnimating={true}
            plugins={streamdownPlugins}
            linkSafety={{ enabled: false }}
            controls={streamdownControls}
            components={streamdownComponents}
          >
            {entry.content}
          </Streamdown>
        </div>
      </div>
    )
  }

  // Settled.
  const closureLabel =
    finalDurationMs != null
      ? `Thought for ${formatElapsedDuration(finalDurationMs)}`
      : `Thought`

  return (
    <div className={styles.settled}>
      <button
        type="button"
        className={styles.toggle}
        onClick={handleToggle}
        aria-expanded={expanded}
      >
        <Text size={1} tone="muted">
          <span className={styles.chevron} aria-hidden="true">
            {expanded ? `▾` : `▸`}
          </span>
          {` `}
          {entry.summary_title
            ? `${closureLabel} — ${entry.summary_title}`
            : closureLabel}
        </Text>
      </button>
      {expanded && (
        <div className={styles.expandedBody}>
          <Streamdown
            isAnimating={false}
            plugins={streamdownPlugins}
            linkSafety={{ enabled: false }}
            controls={streamdownControls}
            components={streamdownComponents}
          >
            {entry.content}
          </Streamdown>
        </div>
      )}
    </div>
  )
}
