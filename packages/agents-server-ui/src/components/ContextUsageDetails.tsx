import {
  formatContextUsagePercent,
  formatTokenCount,
} from '@electric-ax/agents-runtime/client'
import type {
  ContextBreakdownSegment,
  ContextUsage,
} from '@electric-ax/agents-runtime/client'
import styles from './ContextUsageDetails.module.css'

interface ContextUsageDetailsProps {
  usage: ContextUsage
  segments: ReadonlyArray<ContextBreakdownSegment>
  modelId?: string
}

/**
 * Percent label for a legend row. A non-zero segment that would round to `0%`
 * shows `<1%` instead, so a visibly-coloured swatch/bar isn't labelled "0%".
 */
function formatSegmentPercent(ratio: number): string {
  return ratio > 0 && Math.round(ratio * 100) === 0
    ? `<1%`
    : formatContextUsagePercent(ratio)
}

/**
 * The hover/click popover body for the context-usage indicator — a stacked
 * composition bar plus a legend of how each part of the prompt fills the
 * window (à la Claude Code's `/context`). System-prompt and tools figures are
 * approximate; the "Messages" bucket is the real cache-inclusive remainder, so
 * the segments always sum to the gauge.
 */
export function ContextUsageDetails({
  usage,
  segments,
  modelId,
}: ContextUsageDetailsProps): React.ReactElement {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Context usage</span>
        <span className={styles.headline}>
          {formatContextUsagePercent(usage.ratio)}
        </span>
      </div>
      <div className={styles.subhead}>
        {formatTokenCount(usage.usedTokens)} /{` `}
        {formatTokenCount(usage.contextWindow)} tokens
        {modelId ? ` · ${modelId}` : ``}
      </div>

      <div
        className={styles.bar}
        role="img"
        aria-label="Context composition by part"
      >
        {segments.map((seg) =>
          seg.ratio > 0 ? (
            <span
              key={seg.key}
              className={`${styles.barSeg} ${styles[seg.key]}`}
              style={{ width: `${seg.ratio * 100}%` }}
            />
          ) : null
        )}
      </div>

      <ul className={styles.legend}>
        {/* Omit empty buckets (e.g. system/tools for older steps with no
            persisted breakdown), matching the stacked bar above. */}
        {segments
          .filter((seg) => seg.tokens > 0)
          .map((seg) => (
            <li key={seg.key} className={styles.legendRow}>
              <span
                className={`${styles.swatch} ${styles[seg.key]}`}
                aria-hidden="true"
              />
              <span className={styles.legendLabel}>{seg.label}</span>
              <span className={styles.legendTokens}>
                {formatTokenCount(seg.tokens)}
              </span>
              <span className={styles.legendPercent}>
                {formatSegmentPercent(seg.ratio)}
              </span>
            </li>
          ))}
      </ul>

      <div className={styles.note}>System &amp; tools are estimates.</div>
    </div>
  )
}
