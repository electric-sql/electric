import type { CSSProperties } from 'react'

const STATUS_COLORS: Record<string, string> = {
  active: `#3b82f6`,
  running: `#3b82f6`,
  idle: `#22c55e`,
  spawning: `#eab308`,
  stopped: `#cbd5e1`,
}

export function StatusDot({
  status,
  size = 7,
}: {
  status: string
  size?: number
}): React.ReactElement {
  const color = STATUS_COLORS[status] ?? `#cbd5e1`
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: `50%`,
    backgroundColor: color,
    flexShrink: 0,
  }
  return <span style={style} />
}
