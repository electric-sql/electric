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

/**
 * `Intl.NumberFormat` with `notation: 'compact'` gives us "1.2K",
 * "12K", "1.2M" etc., locale-aware and bounded in width — better
 * than a hand-rolled rounder. We force lowercase `k`/`m` afterward
 * so the suffix tone matches the muted meta row.
 */
const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: `compact`,
  maximumFractionDigits: 1,
})

function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  return compactFormatter.format(n).toLowerCase()
}
