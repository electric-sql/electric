import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSection,
  BottomSheetSeparator,
} from './BottomSheet'
import { Icon } from './Icon'
import { useCopyFeedback } from './useCopyFeedback'
import { useDrillTransition } from './useDrillTransition'
import { togglePin, usePinnedUrls } from '../lib/pinnedEntities'
import { useAgents } from '../lib/AgentsProvider'
import { sessionAppUrl, sessionIdFromEntityUrl } from '../lib/sessionLinks'
import { useTokens } from '../lib/ThemeProvider'
import { monoFontFamily } from '../lib/theme'
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
 * toggle (chat / state explorer), a pin toggle (mirror of the desktop
 * tile menu's Pin/Unpin), a Share entry that drills into the share &
 * access screen, plus a status header with a copyable session id.
 * Tapping a
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
  onShare,
  signalDisabled = false,
  onFork,
  forkError,
  forkPending = false,
  forkDisabled = false,
}: {
  open: boolean
  onClose: () => void
  entity: ElectricEntity | null
  view: EmbedViewId
  onSetView: (view: EmbedViewId) => void
  signalError?: string | null
  onSignal?: (signal: EntitySignal) => void
  onStopImmediately?: () => void
  /** Opens the share & access screen. */
  onShare?: () => void
  signalDisabled?: boolean
  /** Forks the whole subtree (HEAD clone); root entities only. */
  onFork?: () => void
  forkError?: string | null
  forkPending?: boolean
  forkDisabled?: boolean
}): React.ReactElement {
  const tokens = useTokens()
  const { serverUrl } = useAgents()
  const { copiedKey, copy } = useCopyFeedback()
  const pinnedUrls = usePinnedUrls()
  const pinned = entity !== null && pinnedUrls.includes(entity.url)
  const [signalMenuOpen, setSignalMenuOpen] = useState(false)
  const {
    style: drillPaneStyle,
    drill,
    reset: resetDrill,
  } = useDrillTransition()

  const entityTerminal =
    entity?.status === `stopped` || entity?.status === `killed`
  // Root-only, matching desktop's tile menu.
  const showFork = entity !== null && !entity.parent && Boolean(onFork)

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
    resetDrill()
    onClose()
  }
  const transitionToMenu = (nextSignalMenuOpen: boolean): void => {
    setSignalMenuOpen(nextSignalMenuOpen)
    drill(nextSignalMenuOpen ? 1 : -1)
  }
  const canOpenSignalMenu =
    entity !== null &&
    entity.status !== `stopped` &&
    entity.status !== `killed` &&
    Boolean(onSignal)
  const handleSignalOption = (
    option: (typeof SIGNAL_OPTION_GROUPS)[number][number]
  ): void => {
    if (signalDisabled) return
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
      resetDrill()
    }
  }, [open])

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
                    {/* Tappable session id — mirrors the desktop
                        entity header's copy-id affordance (icon swaps
                        to a check while the copy feedback is active). */}
                    <Pressable
                      onPress={() =>
                        copy(`id`, sessionIdFromEntityUrl(entity.url))
                      }
                      hitSlop={8}
                      style={{
                        flexDirection: `row`,
                        alignItems: `center`,
                        gap: 6,
                        flexShrink: 1,
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          flexShrink: 1,
                          color: tokens.text3,
                          fontSize: 12,
                          fontFamily: monoFontFamily,
                        }}
                      >
                        {sessionIdFromEntityUrl(entity.url)}
                      </Text>
                      <Icon
                        name={copiedKey === `id` ? `check` : `copy`}
                        size={14}
                        color={tokens.text3}
                        strokeWidth={2}
                      />
                    </Pressable>
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
            {entity && (
              <>
                <BottomSheetSeparator />
                <BottomSheetSection>
                  <BottomSheetItem
                    label={pinned ? `Unpin` : `Pin`}
                    icon={
                      <Icon
                        name="pin"
                        size={18}
                        color={tokens.text2}
                        strokeWidth={2}
                      />
                    }
                    onPress={() => {
                      togglePin(entity.url)
                      handleClose()
                    }}
                  />
                  <BottomSheetItem
                    label={
                      copiedKey === `link` ? `Copied link` : `Copy session link`
                    }
                    icon={
                      <Icon
                        name={copiedKey === `link` ? `check` : `link`}
                        size={18}
                        color={tokens.text2}
                        strokeWidth={2}
                      />
                    }
                    onPress={() =>
                      copy(`link`, sessionAppUrl(serverUrl, entity.url))
                    }
                  />
                  {onShare && (
                    <BottomSheetItem
                      label="Share"
                      icon={
                        <Icon
                          name="share"
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
                      onPress={() => {
                        handleClose()
                        onShare()
                      }}
                    />
                  )}
                  {showFork && (
                    <BottomSheetItem
                      label={forkPending ? `Forking…` : `Fork subtree`}
                      subtitle={
                        forkDisabled && !forkPending
                          ? `Fork permission required`
                          : undefined
                      }
                      icon={
                        <Icon
                          name="git-fork"
                          size={18}
                          color={tokens.text2}
                          strokeWidth={2}
                        />
                      }
                      trailing={
                        forkPending ? (
                          <ActivityIndicator
                            size="small"
                            color={tokens.text3}
                          />
                        ) : undefined
                      }
                      disabled={forkDisabled || forkPending || entityTerminal}
                      // Sheet stays open; the screen closes it on success and
                      // keeps it open to show `forkError` on failure.
                      onPress={() => onFork?.()}
                    />
                  )}
                  {showFork && forkError ? (
                    <Text
                      style={{
                        color: tokens.red11,
                        fontSize: 12,
                        paddingHorizontal: 12,
                        paddingBottom: 8,
                      }}
                    >
                      {forkError}
                    </Text>
                  ) : null}
                </BottomSheetSection>
              </>
            )}
            {canOpenSignalMenu && (
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
                    disabled={signalDisabled}
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
