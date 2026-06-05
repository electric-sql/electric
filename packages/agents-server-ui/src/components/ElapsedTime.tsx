import { useEffect, useState } from 'react'
import { Text } from '../ui'
import { formatElapsedDuration, toMillis } from '../lib/formatTime'
import styles from './ElapsedTime.module.css'

/**
 * Live "Xs / Xm Ys / Xh Ym" elapsed-time label, updated once per
 * second while `enabled` is true. Used in the agent response meta row
 * to show how long the model has been working on the current
 * response — anchored to the preceding user message timestamp so the
 * value reads as "elapsed since I pressed send".
 *
 * We deliberately tear down the interval once `enabled` flips off so
 * settled responses don't keep ticking and re-rendering the timeline.
 *
 * `tabular-nums` (via the module CSS) keeps the digit column from
 * jittering as the seconds tick over.
 */
export function ElapsedTime({
  ts,
  enabled = true,
}: {
  ts: number | null | undefined
  enabled?: boolean
}): React.ReactElement | null {
  const startMs = ts != null ? toMillis(ts) : null
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled || startMs == null) return
    // Snap to current time on (re)enable so a paused timer doesn't
    // show a stale value for up to a second after resuming.
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [enabled, startMs])

  if (startMs == null) return null
  const elapsed = Math.max(0, now - startMs)
  const text = formatElapsedDuration(elapsed)
  return (
    <Text
      size={1}
      tone="muted"
      className={styles.elapsed}
      aria-label={`Elapsed time: ${text}`}
      aria-live="off"
    >
      {text}
    </Text>
  )
}
