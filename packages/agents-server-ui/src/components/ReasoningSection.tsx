import { useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import {
  streamdownComponents,
  streamdownControls,
  streamdownPlugins,
} from '../lib/streamdownConfig'
import { Stack, Text } from '../ui'
import { ThinkingIndicator } from './ThinkingIndicator'
import { ElapsedTime } from './ElapsedTime'
import { formatElapsedDuration } from '../lib/formatTime'
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
  // Stream position of the reasoning row — same `_timeline_order`
  // space as the run's text / tool-call items, so the parent can
  // interleave reasoning blocks at the position they were emitted.
  order: string | number
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
 * step in a tool-using turn — so the parent renders one block per row,
 * interleaved with the run's text / tool-call items by stream order.
 *
 * Expand/collapse state is controlled by the parent (keyed by
 * `entry.key`) rather than owned here, so the user's choice survives
 * this block being unmounted and remounted — e.g. when the reasoning
 * row briefly disappears from the live query while another part of
 * the run updates, or when a virtualizer measurement pass replaces
 * the subtree.
 */
export function ReasoningBlock({
  entry,
  isStreaming,
  expanded,
  onToggle,
}: {
  entry: ReasoningEntry
  isStreaming: boolean
  expanded: boolean
  onToggle: (key: string) => void
}): React.ReactElement {
  const isLive = isStreaming && entry.status === `streaming`
  const handleToggle = useMemo(
    () => () => onToggle(entry.key),
    [entry.key, onToggle]
  )

  // Capture this reasoning row's first live render time. Later rows
  // may start after tool calls, so using the parent run timestamp
  // overstates their duration. Rows mounted already completed keep a
  // bare "Thought" label because we do not know their actual end time.
  const liveStartedAtMsRef = useRef<number | null>(null)
  if (isLive && liveStartedAtMsRef.current == null) {
    liveStartedAtMsRef.current = Date.now()
  }
  const [finalDurationMs, setFinalDurationMs] = useState<number | null>(null)
  useEffect(() => {
    if (
      entry.status === `completed` &&
      liveStartedAtMsRef.current != null &&
      finalDurationMs == null
    ) {
      setFinalDurationMs(Math.max(0, Date.now() - liveStartedAtMsRef.current))
    }
  }, [entry.status, finalDurationMs])

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
          {liveStartedAtMsRef.current != null && (
            <>
              <Text size={1} tone="muted" className={styles.separator}>
                ·
              </Text>
              <ElapsedTime ts={liveStartedAtMsRef.current} enabled={isLive} />
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
