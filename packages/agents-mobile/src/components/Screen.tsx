import { View, type ViewProps } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTokens } from '../lib/ThemeProvider'

/**
 * Top-level screen wrapper.
 *
 * Uses `SafeAreaView` from `react-native-safe-area-context` (NOT the
 * deprecated one in `react-native`) so insets work on both iOS notches
 * and Android edge-to-edge mode (`android.edgeToEdgeEnabled` in
 * `app.json`). The native shell relies on this padding the
 * `MainHeader`-style strip down past the status bar / dynamic island.
 */
export function Screen({
  children,
  style,
  ...props
}: ViewProps): React.ReactElement {
  const tokens = useTokens()
  const insets = useSafeAreaInsets()
  return (
    <View
      {...props}
      // Bottom is owned by screen-specific controls (FABs, composers, sheets),
      // so we only apply top/horizontal keep-out areas here.
      style={[
        {
          flex: 1,
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          backgroundColor: tokens.bg,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}
