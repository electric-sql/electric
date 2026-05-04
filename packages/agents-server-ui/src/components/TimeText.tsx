import { memo, useMemo } from 'react'
import { Text, Tooltip, type TextSize, type TextTone } from '../ui'
import {
  formatAbsoluteDateTimeVerbose,
  formatShortTime,
} from '../lib/formatTime'

type TimeTextProps = {
  /**
   * Timestamp — accepts either seconds or milliseconds since epoch.
   * Normalised internally via `toMillis`.
   */
  ts: number
  /** Visual size — defaults to 1 (matches the existing chat metadata). */
  size?: TextSize
  /** Tone — defaults to muted. */
  tone?: TextTone
  className?: string
  /**
   * Side of the trigger the tooltip should pop on. Defaults to top so
   * it sits above the meta row instead of pushing chat content around.
   */
  side?: `top` | `right` | `bottom` | `left`
}

/**
 * Render a short clock-style timestamp (e.g. `14:18`) with a tooltip
 * exposing the full date / time on hover.
 *
 * Used by chat surfaces (user + assistant message metadata, spawn
 * pill) so every short timestamp in the UI
 * has a consistent way to surface the absolute time without taking
 * up extra horizontal space at rest.
 *
 * The label is the user's locale `HH:MM` (24-hour where the locale
 * prefers it, am/pm otherwise — `toLocaleTimeString` decides). The
 * tooltip content is the verbose date + time with seconds, e.g.
 * `Monday, 4 May 2026 at 14:18:05` — formatted in the same locale
 * so it matches the rest of the timestamps in the app.
 */
export const TimeText = memo(function TimeText({
  ts,
  size = 1,
  tone = `muted`,
  className,
  side = `top`,
}: TimeTextProps): React.ReactElement {
  // Compute both the short and verbose forms once per timestamp.
  // `Intl.DateTimeFormat` is allocation-light but still cheaper to
  // memoise on a row that re-renders during streaming.
  const { short, full } = useMemo(
    () => ({
      short: formatShortTime(ts),
      full: formatAbsoluteDateTimeVerbose(ts),
    }),
    [ts]
  )

  return (
    <Tooltip content={full} side={side}>
      <Text size={size} tone={tone} className={className}>
        {short}
      </Text>
    </Tooltip>
  )
})
