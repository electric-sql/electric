import { type ViewProps } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
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
  return (
    <SafeAreaView
      {...props}
      // Bottom is owned by `KeyboardAvoidingView` + the SidebarFooter,
      // so we only opt into top/horizontal insets here.
      edges={[`top`, `left`, `right`]}
      style={[{ flex: 1, backgroundColor: tokens.bg }, style]}
    >
      {children}
    </SafeAreaView>
  )
}
