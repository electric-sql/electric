import styles from './ThinkingIndicator.module.css'

/**
 * "Thinking" status indicator — the muted-text label with a moving
 * highlight gradient that we paint while the agent has pending work
 * but isn't actively streaming visible tokens (no text yet, between
 * messages, or while a tool call is executing).
 *
 * Visual: the word "Thinking" rendered with `background-clip: text`
 * and a horizontally-scrolling gradient so a brighter highlight
 * sweeps across the letters every couple of seconds. Reads as
 * "still working" without competing with the message body.
 *
 * `role="status"` + `aria-label` exposes the indicator semantically
 * — assistive tech announces the change without having to lip-read
 * a CSS animation.
 */
export function ThinkingIndicator(): React.ReactElement {
  return (
    <span
      className={styles.thinking}
      role="status"
      aria-label="Agent is thinking"
    >
      Thinking
    </span>
  )
}
