import type { CSSProperties } from 'react'

const STATUS_COLORS: Record<string, string> = {
  active: `var(--ds-blue-9)`,
  running: `var(--ds-blue-9)`,
  idle: `var(--ds-green-9)`,
  spawning: `var(--ds-amber-9)`,
  paused: `var(--ds-amber-9)`,
  stopping: `var(--ds-amber-9)`,
  stopped: `var(--ds-gray-8)`,
  killed: `var(--ds-red-9)`,
}

export function StatusDot({
  status,
  size = 6,
}: {
  status: string
  size?: number
}): React.ReactElement {
  const color = STATUS_COLORS[status] ?? `var(--ds-gray-8)`
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: `50%`,
    backgroundColor: color,
    flexShrink: 0,
  }
  return <span style={style} />
}
