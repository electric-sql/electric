import { formatTokenCount } from '@electric-ax/agents-runtime/client'
import { Text } from '../ui'
import styles from './TokenUsage.module.css'

/**
 * Compact token-usage label, e.g. `1.2k ↑ 412 ↓`.
 *
 * Rendered next to the elapsed-time ticker in the agent response
 * meta row, with `tabular-nums` to keep the digit column from
 * jittering as numbers tick up (input grows when a tool result is
 * fed back; output grows when the model streams a new step).
 *
 * `input` is the uncached input side only — fresh prompt tokens plus
 * cache writes, with prompt-cache *reads* excluded. The cache-inclusive
 * total re-counts the entire history on every step, so it balloons into
 * a cumulative number that says nothing about the work this response did.
 *
 * Either side may be `undefined` (the provider didn't emit it, or
 * the section is historical and was recorded before tokens were
 * persisted) — we skip the missing half rather than print `0`.
 */
export function TokenUsage({
  input,
  output,
}: {
  input: number | undefined
  output: number | undefined
}): React.ReactElement | null {
  if (input == null && output == null) return null
  const parts: Array<string> = []
  if (input != null) parts.push(`${formatTokenCount(input)} ↑`)
  if (output != null) parts.push(`${formatTokenCount(output)} ↓`)
  const text = parts.join(` `)
  const ariaParts: Array<string> = []
  if (input != null) ariaParts.push(`${input} input tokens`)
  if (output != null) ariaParts.push(`${output} output tokens`)
  return (
    <Text
      size={1}
      tone="muted"
      className={styles.usage}
      aria-label={ariaParts.join(`, `)}
    >
      {text}
    </Text>
  )
}
