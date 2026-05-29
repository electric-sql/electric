import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSection,
  BottomSheetSeparator,
} from './BottomSheet'
import { Icon } from './Icon'
import { useTokens } from '../lib/ThemeProvider'
import type { ElectricEntity, EntitySignal } from '../lib/agentsClient'
import type { EmbedViewId } from '../lib/embedView'

const STATUS_DOT_COLORS: Record<string, `green` | `blue` | `amber` | `gray`> = {
  running: `blue`,
  idle: `green`,
  paused: `amber`,
  stopping: `amber`,
  spawning: `amber`,
  stopped: `gray`,
  killed: `gray`,
}

const SIGNAL_OPTION_GROUPS: ReadonlyArray<
  ReadonlyArray<{
    id: string
    shortName: string
    description: string
    signal?: EntitySignal
    composite?: `stop-immediately`
    code: string
    destructive?: boolean
  }>
> = [
  [
    {
      id: `interrupt`,
      signal: `SIGINT`,
      shortName: `Interrupt`,
      description: `Abort active run and continue`,
      code: `SIGINT`,
    },
    {
      id: `stop-immediately`,
      composite: `stop-immediately`,
      shortName: `Stop immediately`,
      description: `Abort active run and pause`,
      code: `SIGSTOP+SIGINT`,
    },
  ],
  [
    {
      id: `stop`,
      signal: `SIGSTOP`,
      shortName: `Stop`,
      description: `Pause after current run`,
      code: `SIGSTOP`,
    },
    {
      id: `reload`,
      signal: `SIGHUP`,
      shortName: `Reload`,
      description: `Reload after current run`,
      code: `SIGHUP`,
    },
    {
      id: `resume`,
      signal: `SIGCONT`,
      shortName: `Resume`,
      description: `Resume paused work`,
      code: `SIGCONT`,
    },
    {
      id: `custom`,
      signal: `SIGUSR`,
      shortName: `Custom`,
      description: `Deliver to signal handler`,
      code: `SIGUSR`,
    },
  ],
  [
    {
      id: `terminate`,
      signal: `SIGTERM`,
      shortName: `Terminate`,
      description: `Gracefully stop permanently`,
      code: `SIGTERM`,
      destructive: true,
    },
    {
      id: `kill`,
      signal: `SIGKILL`,
      shortName: `Kill`,
      description: `Immediately kill permanently`,
      code: `SIGKILL`,
      destructive: true,
    },
  ],
]

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
  signalError,
  onSignal,
  onStopImmediately,
}: {
  open: boolean
  onClose: () => void
  entity: ElectricEntity | null
  view: EmbedViewId
  onSetView: (view: EmbedViewId) => void
  signalError?: string | null
  onSignal?: (signal: EntitySignal) => void
  onStopImmediately?: () => void
}): React.ReactElement {
  const tokens = useTokens()
  const [signalMenuOpen, setSignalMenuOpen] = useState(false)
  const [drillDirection, setDrillDirection] = useState(1)
  const drillProgress = useRef(new Animated.Value(1)).current

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
  const handleClose = (): void => {
    setSignalMenuOpen(false)
    drillProgress.setValue(1)
    onClose()
  }
  const transitionToMenu = (nextSignalMenuOpen: boolean): void => {
    setDrillDirection(nextSignalMenuOpen ? 1 : -1)
    drillProgress.setValue(0)
    setSignalMenuOpen(nextSignalMenuOpen)
    Animated.timing(drillProgress, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }
  const canSignal =
    entity !== null &&
    entity.status !== `stopped` &&
    entity.status !== `killed` &&
    Boolean(onSignal)
  const handleSignalOption = (
    option: (typeof SIGNAL_OPTION_GROUPS)[number][number]
  ): void => {
    if (option.composite === `stop-immediately`) {
      onStopImmediately?.()
    } else if (option.signal) {
      onSignal?.(option.signal)
    }
    handleClose()
  }

  useEffect(() => {
    if (!open) {
      setSignalMenuOpen(false)
      drillProgress.setValue(1)
    }
  }, [drillProgress, open])

  const drillPaneStyle = {
    opacity: drillProgress,
    transform: [
      {
        translateX: drillProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [drillDirection * 28, 0],
        }),
      },
    ],
  }

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title={signalMenuOpen ? `Send signal` : undefined}
    >
      <Animated.View style={[styles.drillPane, drillPaneStyle]}>
        {signalMenuOpen ? (
          <>
            <BottomSheetSection>
              <BottomSheetItem
                label="Back"
                icon={
                  <Icon
                    name="back"
                    size={18}
                    color={tokens.text2}
                    strokeWidth={2}
                  />
                }
                onPress={() => transitionToMenu(false)}
              />
            </BottomSheetSection>
            <BottomSheetSeparator />
            <BottomSheetSection label="Signals">
              {SIGNAL_OPTION_GROUPS.map((group, groupIndex) => (
                <View key={groupIndex}>
                  {groupIndex > 0 && <BottomSheetSeparator />}
                  {group.map((option) => (
                    <BottomSheetItem
                      key={option.id}
                      label={option.shortName}
                      icon={
                        <Icon
                          name="radio"
                          size={18}
                          color={
                            option.destructive ? tokens.red11 : tokens.text2
                          }
                          strokeWidth={2}
                        />
                      }
                      destructive={option.destructive}
                      onPress={() => handleSignalOption(option)}
                    />
                  ))}
                </View>
              ))}
            </BottomSheetSection>
          </>
        ) : (
          <>
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
                  {signalError ? (
                    <Text
                      style={{
                        color: tokens.red11,
                        fontSize: 12,
                        paddingHorizontal: 12,
                        paddingBottom: 8,
                      }}
                    >
                      {signalError}
                    </Text>
                  ) : null}
                </BottomSheetSection>
                <BottomSheetSeparator />
              </>
            )}

            <BottomSheetSection label="View">
              <BottomSheetItem
                label="Chat"
                icon={
                  <Icon
                    name="chat"
                    size={18}
                    color={tokens.text2}
                    strokeWidth={2}
                  />
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
            {canSignal && (
              <>
                <BottomSheetSeparator />
                <BottomSheetSection>
                  <BottomSheetItem
                    label="Send signal"
                    icon={
                      <Icon
                        name="radio"
                        size={18}
                        color={tokens.text2}
                        strokeWidth={2}
                      />
                    }
                    trailing={
                      <Icon
                        name="chevron-right"
                        size={16}
                        color={tokens.text3}
                        strokeWidth={2}
                      />
                    }
                    onPress={() => transitionToMenu(true)}
                  />
                </BottomSheetSection>
              </>
            )}
          </>
        )}
      </Animated.View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  drillPane: {
    overflow: `hidden`,
  },
})
