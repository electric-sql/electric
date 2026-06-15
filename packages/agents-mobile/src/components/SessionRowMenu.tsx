import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useLiveQuery } from '@tanstack/react-db'
import {
  formatAbsoluteDateTime,
  formatRelativeTime,
} from '@electric-ax/agents-server-ui/src/lib/formatTime'
import {
  getEntityRunnerId,
  resolveEffectiveSandbox,
  resolveRunner,
  runnerDisplayLabel,
} from '@electric-ax/agents-server-ui/src/lib/entityRuntime'
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSection,
  BottomSheetSeparator,
} from './BottomSheet'
import { Icon } from './Icon'
import { useCopyFeedback } from './useCopyFeedback'
import { useAgents } from '../lib/AgentsProvider'
import { getEntityDisplayTitle, type ElectricEntity } from '../lib/agentsClient'
import { sessionIdFromEntityUrl } from '../lib/sessionLinks'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, monoFontFamily } from '../lib/theme'
import type { Tokens } from '../lib/theme'

/**
 * Long-press context menu for a session row on the home screen.
 * Mobile counterpart of two web-sidebar hover affordances at once:
 * the row info popout (`SidebarRowInfo` — same fields, same
 * formatting helpers) and the pin toggle. In tree mode only root
 * rows open it (the caller gates it, matching the web sidebar);
 * search hits open it at any depth, like the desktop tile menu —
 * a pinned child hoists into the Pinned section.
 */
export function SessionRowMenu({
  open,
  onClose,
  entity,
  childCount,
  pinned,
  onTogglePin,
}: {
  open: boolean
  onClose: () => void
  entity: ElectricEntity | null
  childCount: number
  pinned: boolean
  onTogglePin: () => void
}): React.ReactElement {
  const tokens = useTokens()

  return (
    <BottomSheet open={open} onClose={onClose}>
      {entity && (
        <>
          <EntityInfo entity={entity} childCount={childCount} />
          <BottomSheetSeparator />
        </>
      )}
      <BottomSheetSection>
        <BottomSheetItem
          label={pinned ? `Unpin` : `Pin`}
          icon={
            <Icon name="pin" size={18} color={tokens.text2} strokeWidth={2} />
          }
          onPress={() => {
            onTogglePin()
            onClose()
          }}
        />
      </BottomSheetSection>
    </BottomSheet>
  )
}

/**
 * Info header — field-for-field mirror of the web hover card. Split
 * out so the runners live query only subscribes while the sheet has
 * an entity (it stays mounted, closed, for the screen's lifetime).
 */
function EntityInfo({
  entity,
  childCount,
}: {
  entity: ElectricEntity
  childCount: number
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const { runnersCollection } = useAgents()
  const { copiedKey, copy } = useCopyFeedback()

  // Resolve runner/sandbox labels via the shared pure helpers (the
  // web's `useEntityRuntimeInfo` reads its own provider context, so
  // mobile queries its runners collection directly).
  const { data: runners = [] } = useLiveQuery(
    (q) => q.from({ r: runnersCollection }),
    [runnersCollection]
  )

  const runnerId = getEntityRunnerId(entity)
  const runner = resolveRunner(runners, runnerId)
  const runnerLabel = runnerId ? runnerDisplayLabel(runner, runnerId) : null
  const sandboxLabel = resolveEffectiveSandbox(runners, entity, runner).label

  return (
    <View style={styles.info}>
      <Text style={styles.infoTitle} numberOfLines={2}>
        {getEntityDisplayTitle(entity)}
      </Text>
      <Pressable
        onPress={() => copy(`id`, sessionIdFromEntityUrl(entity.url))}
        hitSlop={8}
        style={styles.infoIdRow}
      >
        <Text style={styles.infoId} numberOfLines={1}>
          {sessionIdFromEntityUrl(entity.url)}
        </Text>
        <Icon
          name={copiedKey === `id` ? `check` : `copy`}
          size={14}
          color={tokens.text3}
          strokeWidth={2}
        />
      </Pressable>
      <Text style={styles.infoMeta} numberOfLines={1}>
        {entity.type} · {entity.status}
        {childCount > 0
          ? ` · ${childCount} subagent${childCount === 1 ? `` : `s`}`
          : ``}
      </Text>
      <View style={styles.infoRows}>
        {runnerLabel && <InfoRow label="Runner" value={runnerLabel} />}
        {sandboxLabel && <InfoRow label="Sandbox" value={sandboxLabel} />}
        <InfoRow
          label="Spawned"
          value={formatAbsoluteDateTime(entity.created_at)}
        />
        <InfoRow
          label="Last active"
          value={formatRelativeTime(entity.updated_at)}
        />
      </View>
    </View>
  )
}

function InfoRow({
  label,
  value,
}: {
  label: string
  value: string
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoRowLabel}>{label}</Text>
      <Text style={styles.infoRowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    info: {
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 8,
      gap: 2,
    },
    infoTitle: {
      color: tokens.text1,
      fontSize: fontSize.base,
      fontWeight: `500`,
      lineHeight: 20,
    },
    infoIdRow: {
      alignSelf: `flex-start`,
      flexDirection: `row`,
      alignItems: `center`,
      gap: 6,
      maxWidth: `100%`,
    },
    infoId: {
      flexShrink: 1,
      color: tokens.text3,
      fontSize: fontSize.sm,
      fontFamily: monoFontFamily,
    },
    infoMeta: {
      color: tokens.text3,
      fontSize: fontSize.sm,
    },
    infoRows: {
      marginTop: 8,
      gap: 4,
    },
    infoRow: {
      flexDirection: `row`,
      alignItems: `baseline`,
      gap: 12,
    },
    infoRowLabel: {
      width: 80,
      flexShrink: 0,
      color: tokens.text3,
      fontSize: fontSize.sm,
    },
    infoRowValue: {
      flex: 1,
      color: tokens.text2,
      fontSize: fontSize.sm,
    },
  })
}
