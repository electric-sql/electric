import { StyleSheet, View } from 'react-native'

/**
 * Small circular indicator that mirrors the web sidebar's status dot
 * (`agents-server-ui/src/components/StatusDot.tsx`).
 *
 * The palette is **fixed across themes** on the web — both light and
 * dark sidebars use these exact hex values for status hues — so we
 * mirror that here instead of routing through `Tokens` to keep the
 * dot looking identical to its web counterpart on every device.
 */

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
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.stopped
  return (
    <View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  dot: {
    flexShrink: 0,
  },
})
