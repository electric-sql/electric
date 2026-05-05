import { Text, View } from 'react-native'
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSection,
  BottomSheetSeparator,
} from './BottomSheet'
import { Icon } from './Icon'
import { useTokens } from '../lib/ThemeProvider'
import type { ElectricEntity } from '../lib/agentsClient'
import type { EmbedViewId } from '../webview/embedSource'

const STATUS_DOT_COLORS: Record<string, `green` | `blue` | `amber` | `gray`> = {
  running: `blue`,
  idle: `green`,
  spawning: `amber`,
  stopped: `gray`,
}

/**
 * Bottom-sheet "more" menu for the chat screen — exposes the view
 * toggle (chat / state explorer) plus a status header. Tapping a
 * row immediately switches the view and dismisses the sheet, so the
 * user can swap between modes in one tap-tap gesture (kebab → mode).
 */
export function SessionMenu({
  open,
  onClose,
  entity,
  view,
  onSetView,
}: {
  open: boolean
  onClose: () => void
  entity: ElectricEntity | null
  view: EmbedViewId
  onSetView: (view: EmbedViewId) => void
}): React.ReactElement {
  const tokens = useTokens()

  const dotKey = entity ? (STATUS_DOT_COLORS[entity.status] ?? `gray`) : `gray`
  const dotColor =
    dotKey === `green`
      ? tokens.green9
      : dotKey === `blue`
        ? tokens.blue9
        : dotKey === `amber`
          ? tokens.amber9
          : tokens.gray9

  const handlePick = (next: EmbedViewId): void => {
    onSetView(next)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      {entity && (
        <>
          <BottomSheetSection label="Status">
            <View
              style={{
                flexDirection: `row`,
                alignItems: `center`,
                gap: 10,
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: dotColor,
                }}
              />
              <Text
                style={{
                  color: tokens.text1,
                  fontSize: 14,
                  textTransform: `capitalize`,
                }}
              >
                {entity.status}
              </Text>
              <View style={{ flex: 1 }} />
              <Text
                style={{
                  color: tokens.text3,
                  fontSize: 12,
                  textTransform: `lowercase`,
                }}
              >
                {entity.type}
              </Text>
            </View>
          </BottomSheetSection>
          <BottomSheetSeparator />
        </>
      )}

      <BottomSheetSection label="View">
        <BottomSheetItem
          label="Chat"
          icon={
            <Icon name="chat" size={18} color={tokens.text2} strokeWidth={2} />
          }
          active={view === `chat`}
          onPress={() => handlePick(`chat`)}
        />
        <BottomSheetItem
          label="State explorer"
          icon={
            <Icon
              name="database"
              size={18}
              color={tokens.text2}
              strokeWidth={2}
            />
          }
          active={view === `state-explorer`}
          onPress={() => handlePick(`state-explorer`)}
        />
      </BottomSheetSection>
    </BottomSheet>
  )
}
