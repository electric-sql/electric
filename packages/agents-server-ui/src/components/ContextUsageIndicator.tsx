import { useMemo } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  computeContextUsage,
  contextUsageLevel,
  formatContextUsagePercent,
  formatTokenCount,
} from '@electric-ax/agents-runtime/client'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime/client'
import { Tooltip } from '../ui/Tooltip'
import styles from './ContextUsageIndicator.module.css'

/**
 * Phase-0 context-window gauge for the composer footer (à la Claude Code's
 * "X% used"). It reads the *same* numbers the runtime persists for compaction
 * — the latest step's cache-inclusive prompt size and the model's context
 * window — and divides them through `computeContextUsage`, the shared source of
 * truth. Nothing acts on the ratio yet; this is purely observational and lets
 * us eyeball-validate the token accounting before later phases trigger off it.
 */

interface StepRow {
  _seq?: number
  context_input_tokens?: number
  context_window?: number
  output_tokens?: number
  model_id?: string
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
    return computed ? { ...computed, modelId: latest.model_id } : null
  }, [steps])

  if (!usage) return null

  const level = contextUsageLevel(usage.ratio)
  const percent = formatContextUsagePercent(usage.ratio)
  const tokensLabel = `${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(
    usage.contextWindow
  )} tokens`
  const tooltip = usage.modelId
    ? `${tokensLabel} · ${usage.modelId}`
    : tokensLabel

  return (
    <Tooltip content={`Context used — ${tooltip}`} side="top">
      <span
        className={[styles.indicator, styles[level]].filter(Boolean).join(` `)}
        aria-label={`Context used: ${percent} (${tooltip})`}
      >
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.percent}>{percent}</span>
      </span>
    </Tooltip>
  )
}
