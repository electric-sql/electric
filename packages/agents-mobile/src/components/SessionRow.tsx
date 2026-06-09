import { memo, useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Icon } from './Icon'
import { StatusDot } from './StatusDot'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, radii } from '../lib/theme'
import { getEntityDisplayTitle, type ElectricEntity } from '../lib/agentsClient'
import { normalizePrincipalUrl } from '@electric-ax/agents-server-ui/src/lib/principals'
import type { Tokens } from '../lib/theme'

/**
 * Geometry constants — kept in lockstep with the web's `SidebarRow`
 * (`packages/agents-server-ui/src/components/SidebarRow.tsx` and
 * `.module.css`) so a port back later doesn't need a re-design.
 *
 * `BASE_PADDING_LEFT` is bumped from the web's 3px → 8px because
 * mobile rows are taller (44pt touch target) and benefit from a
 * roomier left margin. `INDENT_PX`, `ICON_SLOT` and the tree-line
 * widths match the web exactly so connector visuals are 1:1.
 */
export const BASE_PADDING_LEFT = 8
export const INDENT_PX = 12
export const ICON_SLOT = 22
export const ICON_SLOT_HALF = 11
export const ROW_HEIGHT = 44
const TREE_STUB_WIDTH = 9
const TREE_CORNER_RADIUS = 6

export type SessionRowConnector = {
  /**
   * X-position of the parent's icon-column centre, expressed in the
   * row's own coordinate space. Pre-computed by `<SessionTree>` from
   * `BASE_PADDING_LEFT + parentDepth * INDENT_PX + ICON_SLOT_HALF`
   * so connector lines line up with the parent dot above.
   */
  trunkX: number
  /**
   * `true` if this row is the bottom-most sibling in its subtree.
   * Last-sibling rows draw an L-shaped trunk (vertical → curve →
   * horizontal) instead of a straight pass-through.
   */
  isLastSibling: boolean
}

/**
 * One row in the home-screen sessions list. ChatGPT-style title-only
 * row with web-sidebar parity: status dot in a 22px icon column,
 * type label + child count when subtree is collapsed, expand chevron
 * on hover-equivalent (mobile shows it always), tree connectors
 * drawn behind the row.
 *
 * Stopped sessions drop to 0.55 opacity (matches `.stopped` in
 * `SidebarRow.module.css`).
 */
export const SessionRow = memo(function SessionRow({
  entity,
  depth,
  childCount = 0,
  expanded = false,
  onToggleExpand,
  onPress,
  onLongPress,
  connector = null,
  currentPrincipalUrl = null,
}: {
  entity: ElectricEntity
  depth: number
  childCount?: number
  expanded?: boolean
  onToggleExpand?: () => void
  onPress: () => void
  onLongPress?: () => void
  connector?: SessionRowConnector | null
  currentPrincipalUrl?: string | null
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const title = getEntityDisplayTitle(entity)
  const isStopped = entity.status === `stopped`
  const hasChildren = childCount > 0
  const paddingLeft = BASE_PADDING_LEFT + depth * INDENT_PX
  const creatorUrl = normalizePrincipalUrl(entity.created_by)
  const shared =
    creatorUrl !== null &&
    currentPrincipalUrl !== null &&
    creatorUrl !== currentPrincipalUrl

  return (
    <View style={[styles.row, isStopped ? styles.stopped : null]}>
      {connector ? (
        <Connector
          trunkX={connector.trunkX}
          isLastSibling={connector.isLastSibling}
          color={tokens.border2}
        />
      ) : null}

      <Pressable
        style={[styles.rowMain, { paddingLeft }]}
        onPress={onPress}
        onLongPress={onLongPress}
        // 350ms; RN's 500ms default feels unresponsive for a context menu.
        delayLongPress={350}
        accessibilityHint={
          onLongPress ? `Long press for session options` : undefined
        }
      >
        {({ pressed }) => (
          <>
            <View
              style={[
                StyleSheet.absoluteFillObject,
                styles.pressOverlay,
                pressed ? styles.pressOverlayActive : null,
              ]}
            />
            <View style={styles.iconSlot}>
              <StatusDot status={entity.status} />
            </View>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <View style={styles.meta}>
              {shared ? (
                <Icon
                  name="users"
                  size={13}
                  color={tokens.text3}
                  strokeWidth={2}
                />
              ) : null}
              <Text style={styles.type} numberOfLines={1}>
                {entity.type}
                {hasChildren && !expanded ? ` +${childCount}` : ``}
              </Text>
            </View>
          </>
        )}
      </Pressable>

      {hasChildren && onToggleExpand ? (
        <Pressable
          style={styles.expand}
          onPress={onToggleExpand}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={
            expanded
              ? `Collapse subtree`
              : `Expand subtree (${childCount} subagent${childCount === 1 ? `` : `s`})`
          }
          accessibilityState={{ expanded }}
        >
          {({ pressed }) => (
            <View
              style={[
                styles.expandInner,
                pressed ? styles.expandPressed : null,
              ]}
            >
              <Icon
                name={expanded ? `chevron-down` : `chevron-right`}
                size={16}
                color={tokens.text2}
                strokeWidth={2}
              />
            </View>
          )}
        </Pressable>
      ) : null}
    </View>
  )
})

/**
 * Decorative tree connector behind a child row.
 *
 *   non-last sibling  : continuous trunk (top→bottom) + horizontal stub at mid
 *   last sibling      : L-shape (top→mid → curve → horizontal stub) only
 *
 * The geometry matches `SidebarRow.module.css` `.subtree > … > .row`
 * pseudo-elements 1:1 (trunk_x − 0.5px alignment, 9px stub width,
 * 6px corner radius, `--ds-border-2` colour). Drawn per-row so the
 * line stays continuous through the row stack regardless of parent
 * box geometry.
 */
function Connector({
  trunkX,
  isLastSibling,
  color,
}: {
  trunkX: number
  isLastSibling: boolean
  color: string
}): React.ReactElement {
  if (isLastSibling) {
    return (
      <View
        pointerEvents="none"
        style={{
          position: `absolute`,
          left: trunkX - 0.5,
          top: 0,
          height: ROW_HEIGHT / 2,
          width: TREE_STUB_WIDTH + 0.5,
          borderLeftWidth: 1,
          borderBottomWidth: 1,
          borderColor: color,
          borderBottomLeftRadius: TREE_CORNER_RADIUS,
        }}
      />
    )
  }
  return (
    <>
      <View
        pointerEvents="none"
        style={{
          position: `absolute`,
          left: trunkX - 0.5,
          top: 0,
          bottom: 0,
          borderLeftWidth: 1,
          borderColor: color,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: `absolute`,
          left: trunkX,
          top: ROW_HEIGHT / 2 - 0.5,
          width: TREE_STUB_WIDTH,
          borderTopWidth: 1,
          borderColor: color,
        }}
      />
    </>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    row: {
      position: `relative`,
      flexDirection: `row`,
      alignItems: `stretch`,
      height: ROW_HEIGHT,
    },
    stopped: {
      opacity: 0.55,
    },
    rowMain: {
      flex: 1,
      flexDirection: `row`,
      alignItems: `center`,
      gap: 6,
      paddingRight: 6,
      borderRadius: radii.lg,
      overflow: `hidden`,
    },
    // Sits behind the row content via `absoluteFillObject`. Lit on
    // press to mirror `:hover { background: --ds-bg-hover }` from
    // the web sidebar without breaking the connector lines that
    // share the row's z-stack.
    pressOverlay: {
      backgroundColor: `transparent`,
      borderRadius: radii.lg,
    },
    pressOverlayActive: {
      backgroundColor: tokens.bgHover,
    },
    iconSlot: {
      width: ICON_SLOT,
      height: ICON_SLOT,
      flexShrink: 0,
      alignItems: `center`,
      justifyContent: `center`,
    },
    title: {
      flex: 1,
      minWidth: 0,
      color: tokens.text1,
      fontSize: fontSize.base,
      lineHeight: 20,
    },
    meta: {
      maxWidth: `45%`,
      flexShrink: 0,
      flexDirection: `row`,
      alignItems: `center`,
      gap: 4,
    },
    type: {
      flexShrink: 0,
      color: tokens.text3,
      fontSize: 11,
      lineHeight: 12,
      textTransform: `lowercase`,
      transform: [{ translateY: 1 }],
    },
    expand: {
      flexShrink: 0,
      width: 36,
      alignItems: `center`,
      justifyContent: `center`,
    },
    expandInner: {
      width: 28,
      height: 28,
      borderRadius: radii.md,
      alignItems: `center`,
      justifyContent: `center`,
    },
    expandPressed: {
      backgroundColor: tokens.bgHover,
    },
  })
}
