import styles from './ContextUsageIndicator.module.css'

interface ContextUsageRingProps {
  /** Fraction of the context window used, 0–1. */
  ratio: number
  /** Outer diameter in px. */
  size?: number
  /** Ring thickness in px. */
  strokeWidth?: number
}

/**
 * A tiny circular gauge ("donut") whose arc fills proportionally to `ratio`.
 * Both the track and the progress arc use `currentColor`, so the surrounding
 * indicator's level colour (normal/warning/critical) tints it for free.
 */
export function ContextUsageRing({
  ratio,
  size = 14,
  strokeWidth = 2.5,
}: ContextUsageRingProps): React.ReactElement {
  const clamped = Math.min(1, Math.max(0, ratio))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const filled = circumference * clamped
  const center = size / 2

  return (
    <svg
      className={styles.ring}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <circle
        className={styles.ringTrack}
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
      />
      <circle
        className={styles.ringProgress}
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference - filled}`}
        // Start the arc at 12 o'clock and sweep clockwise.
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  )
}
