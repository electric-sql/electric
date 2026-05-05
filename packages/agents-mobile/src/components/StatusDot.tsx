import { View } from 'react-native'
import { useTokens } from '../lib/ThemeProvider'
import type { EntityStatus } from '../lib/agentsClient'

export function StatusDot({
  status,
  size = 8,
}: {
  status: EntityStatus
  size?: number
}): React.ReactElement {
  const tokens = useTokens()
  const color =
    status === `running`
      ? tokens.blue9
      : status === `idle`
        ? tokens.green9
        : status === `spawning`
          ? tokens.amber9
          : tokens.gray9
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
      }}
    />
  )
}
