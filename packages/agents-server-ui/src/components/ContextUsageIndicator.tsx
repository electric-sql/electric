import { useMemo } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  computeContextUsage,
  computeContextBreakdown,
  parseContextBreakdown,
  contextUsageLevel,
  formatContextUsagePercent,
  formatTokenCount,
} from '@electric-ax/agents-runtime/client'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime/client'
import { HoverCard } from '../ui/HoverCard'
import { ContextUsageRing } from './ContextUsageRing'
import { ContextUsageDetails } from './ContextUsageDetails'
import styles from './ContextUsageIndicator.module.css'

/**
 * Context-window gauge for the composer footer ("X% used") — a ring + percent
 * over the latest step's usage (computeContextUsage). Hovering reveals a
 * per-part composition breakdown.
 */

interface StepRow {
  _seq?: number
  context_input_tokens?: number
  context_window?: number
  output_tokens?: number
  model_id?: string
  context_breakdown?: string
}

interface ContextUsageIndicatorProps {
  db: EntityStreamDBWithActions | null
}

export function ContextUsageIndicator({
  db,
}: ContextUsageIndicatorProps): React.ReactElement | null {
  const { data: steps = [] } = useLiveQuery(
    (q) =>
      db && db.collections.steps
        ? q.from({ step: db.collections.steps as any })
        : undefined,
    [db]
  )

  const usage = useMemo(() => {
    // The most-recently-started step that reported context usage holds the
    // freshest, fullest prompt size (the last step of the latest run carries
    // the whole conversation). `_seq` is the collection's monotonic insertion
    // order, so the max among completed steps is the latest.
    let latest: StepRow | null = null
    for (const row of steps as Array<StepRow>) {
      if (
        typeof row.context_window !== `number` ||
        row.context_window <= 0 ||
        typeof row.context_input_tokens !== `number`
      ) {
        continue
      }
      if (!latest || (row._seq ?? 0) > (latest._seq ?? 0)) {
        latest = row
      }
    }
    if (!latest) return null
    const computed = computeContextUsage({
      contextInputTokens: latest.context_input_tokens as number,
      outputTokens: latest.output_tokens,
      contextWindow: latest.context_window as number,
    })
    if (!computed) return null
    return {
      ...computed,
      modelId: latest.model_id,
      segments: computeContextBreakdown(
        computed,
        parseContextBreakdown(latest.context_breakdown)
      ),
    }
  }, [steps])

  if (!usage) return null

  const level = contextUsageLevel(usage.ratio)
  const percent = formatContextUsagePercent(usage.ratio)
  // Keep the essential numbers in the trigger's own label: the breakdown popover
  // is hover-only (Base UI PreviewCard), so keyboard/screen-reader users would
  // otherwise get only the percent from the trigger.
  const tokensLabel = `${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(
    usage.contextWindow
  )} tokens`
  const ariaLabel = `Context used: ${percent} (${tokensLabel}${
    usage.modelId ? ` · ${usage.modelId}` : ``
  }) — hover for breakdown`

  return (
    <HoverCard.Root>
      <HoverCard.Trigger
        render={
          <span
            className={[styles.indicator, styles[level]]
              .filter(Boolean)
              .join(` `)}
            aria-label={ariaLabel}
          >
            <ContextUsageRing ratio={usage.ratio} />
            <span className={styles.percent}>{percent}</span>
          </span>
        }
      />
      <HoverCard.Content side="top" align="end">
        <ContextUsageDetails
          usage={usage}
          segments={usage.segments}
          modelId={usage.modelId}
        />
      </HoverCard.Content>
    </HoverCard.Root>
  )
}
