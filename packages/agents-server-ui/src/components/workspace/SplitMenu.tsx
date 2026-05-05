import { useState } from 'react'
import {
  Copy,
  Eye,
  GitFork,
  Link2,
  MoreHorizontal,
  Pin,
  PinOff,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Trash2,
  X,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useWorkspace, listTiles } from '../../hooks/useWorkspace'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { usePinnedEntities } from '../../hooks/usePinnedEntities'
import { listViews } from '../../lib/workspace/viewRegistry'
import type { EntityViewDefinition } from '../../lib/workspace/viewRegistry'
import { encodeLayout } from '../../lib/workspace/layoutCodec'
import { Button, Dialog, IconButton, Menu, Stack, Text } from '../../ui'
import { modKeyLabel } from '../../lib/keyLabels'
import { getEntityDisplayTitle } from '../../lib/entityDisplay'
import type { ElectricEntity } from '../../lib/ElectricAgentsProvider'
import type { Tile } from '../../lib/workspace/types'
import styles from './SplitMenu.module.css'

/**
 * Per-tile workspace menu. Shown in the tile header (the `…` button)
 * and contains, in order:
 *
 * - **Inspect**                   open the entity JSON in a dialog.
 * - **View** (label)              section header for the inline view rows.
 * - **{view rows}**               one row per available view. The row's
 *                                 main label clicks "open this view here"
 *                                 (swap in place); the trailing two icon
 *                                 buttons split the tile to the side
 *                                 ([→]) or below ([↓]) with that view.
 * - **Split right / down**        duplicate the active tile into a new
 *                                 split (current view, right / down).
 * - **Copy URL · Copy layout link · Pin · Fork**  entity-level actions.
 * - **Close tile**                remove this tile (collapses parent split).
 * - **Kill entity**               (destructive) confirmation-gated.
 *
 * Replaces the previous "View ▸" / "Move tile to ▸" submenu design —
 * Base UI's nested-menu interactions were brittle (clicking the parent
 * row only opened the submenu, never the default action) and the user
 * preferred direct, in-line controls.
 */
export function SplitMenu({
  tile,
  entity,
}: {
  tile: Tile
  /**
   * The live entity for this tile, or `null` for a standalone tile
   * (new-session). When null, entity-specific items (Inspect, Pin,
   * Fork, Copy URL, Kill) are hidden — only the layout-level items
   * (split, close, copy layout link) remain.
   */
  entity: ElectricEntity | null
}): React.ReactElement {
  const { workspace, helpers } = useWorkspace()
  const { forkEntity, killEntity } = useElectricAgents()
  const { pinnedUrls, togglePin } = usePinnedEntities()
  const navigate = useNavigate()
  const hasEntity = entity !== null && tile.entityUrl !== null
  const entityUrl = tile.entityUrl
  const pinned = entityUrl !== null && pinnedUrls.includes(entityUrl)
  // Hide "Close tile" when this is the only tile in the workspace —
  // closing it would leave the workspace empty (which the URL ↔
  // workspace effect would immediately re-bootstrap), so the action
  // is at best a no-op flicker and at worst confusing.
  const isOnlyTile = listTiles(workspace.root).length <= 1
  const [menuOpen, setMenuOpen] = useState(false)
  const [showInspect, setShowInspect] = useState(false)
  const [showKillConfirm, setShowKillConfirm] = useState(false)
  const instanceName = entity ? getEntityDisplayTitle(entity).title : ``

  const close = () => setMenuOpen(false)
  /** Wraps a handler so it dispatches and then closes the menu. */
  const run = (fn: () => void) => () => {
    fn()
    close()
  }

  // Entity tiles get the full per-entity view list; standalone tiles
  // only ever have their own (standalone) view, which doesn't belong
  // in the entity view-switcher — so the View section just stays
  // hidden for them.
  const availableViews = entity ? listViews(entity) : []

  const handleFork = () => {
    if (!forkEntity || entityUrl === null) return
    void forkEntity(entityUrl)
      .then((root) =>
        navigate({
          to: `/entity/$`,
          params: { _splat: root.url.replace(/^\//, ``) },
        })
      )
      .catch(() => {})
  }

  const handleKill = () => {
    if (!killEntity || entityUrl === null) return
    const tx = killEntity(entityUrl)
    tx.isPersisted.promise.catch(() => {})
  }

  const handleCopyLayoutLink = () => {
    // Encode the workspace into the DSL and append it as `?layout=…`
    // to the current URL. The receiving window's <Workspace> picks it
    // up, hydrates, and strips the param so its address bar settles
    // back to "active tile only" — see §3.4 of the plan.
    const encoded = encodeLayout(workspace)
    const url = new URL(window.location.href)
    const hash = url.hash.replace(/^#/, ``)
    const [path, query = ``] = hash.split(`?`)
    const params = new URLSearchParams(query)
    if (encoded) params.set(`layout`, encoded)
    else params.delete(`layout`)
    const newQuery = params.toString()
    url.hash = `#` + path + (newQuery ? `?` + newQuery : ``)
    void navigator.clipboard.writeText(url.toString())
  }

  // The menu and the dialogs are siblings — keeping them in the same
  // <Menu.Root> portal subtree caused focus / unmount races (Base UI
  // tears the menu popup down on close, and any dialog mounted inside
  // that subtree got caught in the teardown).
  return (
    <>
      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger
          render={
            <IconButton
              variant="ghost"
              tone="neutral"
              size={1}
              aria-label="Tile actions"
              title="Tile actions"
            >
              <MoreHorizontal size={16} />
            </IconButton>
          }
        />
        <Menu.Content side="bottom" align="end">
          {hasEntity && (
            <>
              <Menu.Item onSelect={() => setShowInspect(true)}>
                <Eye size={14} />
                <Text size={2}>Inspect</Text>
              </Menu.Item>

              <Menu.Separator />
            </>
          )}

          {availableViews.length > 0 && (
            <>
              <div className={styles.sectionLabel} aria-hidden="true">
                View
              </div>
              {availableViews.map((view) => (
                <ViewRow
                  key={view.id}
                  view={view}
                  isActive={view.id === tile.viewId}
                  onOpenHere={run(() => helpers.setTileView(tile.id, view.id))}
                  onSplitRight={run(() =>
                    helpers.splitTileWithView(tile.id, view.id, `right`)
                  )}
                  onSplitDown={run(() =>
                    helpers.splitTileWithView(tile.id, view.id, `down`)
                  )}
                />
              ))}

              <Menu.Separator />
            </>
          )}

          <Menu.Item onSelect={() => helpers.splitTile(tile.id, `right`)}>
            <SplitSquareHorizontal size={14} />
            <Text size={2}>Split right</Text>
            <span className={styles.shortcut}>{modKeyLabel(`d`)}</span>
          </Menu.Item>
          <Menu.Item onSelect={() => helpers.splitTile(tile.id, `down`)}>
            <SplitSquareVertical size={14} />
            <Text size={2}>Split down</Text>
            <span className={styles.shortcut}>
              {modKeyLabel({ letter: `d`, shift: true })}
            </span>
          </Menu.Item>

          <Menu.Separator />

          {hasEntity && entityUrl !== null && (
            <>
              <Menu.Item
                onSelect={() => {
                  void navigator.clipboard.writeText(entityUrl)
                }}
              >
                <Copy size={14} />
                <Text size={2}>Copy URL</Text>
              </Menu.Item>
            </>
          )}
          <Menu.Item onSelect={handleCopyLayoutLink}>
            <Link2 size={14} />
            <Text size={2}>Copy layout link</Text>
          </Menu.Item>
          {hasEntity && entityUrl !== null && (
            <Menu.Item onSelect={() => togglePin(entityUrl)}>
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
              <Text size={2}>{pinned ? `Unpin` : `Pin`}</Text>
            </Menu.Item>
          )}
          {hasEntity && entity && forkEntity && !entity.parent && (
            <Menu.Item
              onSelect={handleFork}
              disabled={entity.status === `stopped`}
            >
              <GitFork size={14} />
              <Text size={2}>Fork subtree</Text>
            </Menu.Item>
          )}

          {!isOnlyTile && (
            <>
              <Menu.Separator />
              <Menu.Item onSelect={() => helpers.closeTile(tile.id)}>
                <X size={14} />
                <Text size={2}>Close tile</Text>
                <span className={styles.shortcut}>{modKeyLabel(`w`)}</span>
              </Menu.Item>
            </>
          )}

          {hasEntity && entity && entity.status !== `stopped` && killEntity && (
            <>
              <Menu.Separator />
              <Menu.Item
                onSelect={() => setShowKillConfirm(true)}
                tone="danger"
              >
                <Trash2 size={14} />
                <Text size={2}>Kill entity</Text>
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Root>

      {hasEntity && entity && (
        <Dialog.Root open={showInspect} onOpenChange={setShowInspect}>
          <Dialog.Content maxWidth={600}>
            <Dialog.Title>Entity details</Dialog.Title>
            <pre className={styles.inspectPre}>
              {JSON.stringify(entity, null, 2)}
            </pre>
            <Stack justify="end" className={styles.dialogActions}>
              <Dialog.Close
                render={
                  <Button variant="soft" tone="neutral">
                    Close
                  </Button>
                }
              />
            </Stack>
          </Dialog.Content>
        </Dialog.Root>
      )}

      {hasEntity && entity && (
        <Dialog.Root open={showKillConfirm} onOpenChange={setShowKillConfirm}>
          <Dialog.Content maxWidth={400}>
            <Dialog.Title>Kill entity</Dialog.Title>
            <Text size={2} tone="muted">
              Are you sure you want to kill {instanceName}? The entity will stop
              processing and its stream will become read-only.
            </Text>
            <Stack justify="end" gap={2} className={styles.killActions}>
              <Dialog.Close
                render={
                  <Button variant="soft" tone="neutral">
                    Cancel
                  </Button>
                }
              />
              <Button
                onClick={() => {
                  handleKill()
                  setShowKillConfirm(false)
                }}
              >
                Kill
              </Button>
            </Stack>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  )
}

/**
 * One inline row in the View section of the tile menu.
 *
 * Layout: `[icon] Label [✓?]                 [→][↓]`
 *
 * - Click anywhere on the row body  → swap this view into the current
 *                                     tile (Menu.Item activation).
 * - Click `[→]`                     → split right with this view.
 * - Click `[↓]`                     → split down with this view.
 *
 * Implementation note: the row IS a Menu.Item (not a custom div) so
 * Base UI's keyboard navigation, hover styling and focus management
 * treat it the same as any other menu entry. The trailing icon
 * buttons stop propagation so the row's `onSelect` doesn't fire when
 * the user is targeting one of them — they then call their own
 * handler (which also closes the controlled menu via `run()` in the
 * parent).
 */
function ViewRow({
  view,
  isActive,
  onOpenHere,
  onSplitRight,
  onSplitDown,
}: {
  view: EntityViewDefinition
  isActive: boolean
  onOpenHere: () => void
  onSplitRight: () => void
  onSplitDown: () => void
}): React.ReactElement {
  const Icon = view.icon
  // Each icon-button stops propagation so the row's Menu.Item never
  // sees the click — otherwise the row's `onSelect` (open here) would
  // fire alongside the split. We then manually invoke the split
  // handler, which also closes the menu via the parent's `run()`.
  const stopAndDo = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    fn()
  }
  return (
    <Menu.Item
      onSelect={onOpenHere}
      className={styles.viewRow}
      aria-label={
        isActive
          ? `${view.label} (active)`
          : `Switch this tile to ${view.label}`
      }
    >
      <Icon size={14} />
      <Text size={2}>{view.label}</Text>
      {isActive && (
        <span className={styles.viewActiveTick} aria-label="active view">
          ✓
        </span>
      )}
      <span className={styles.viewRowSpacer} />
      <button
        type="button"
        className={styles.viewRowAction}
        onClick={stopAndDo(onSplitRight)}
        // Pointer-down too: Base UI activates Menu.Items on
        // mouse-down so a normal `onClick` would lose the race.
        onPointerDown={(e) => e.stopPropagation()}
        title={`Open ${view.label} to the side`}
        aria-label={`Open ${view.label} to the side`}
      >
        <SplitSquareHorizontal size={12} />
      </button>
      <button
        type="button"
        className={styles.viewRowAction}
        onClick={stopAndDo(onSplitDown)}
        onPointerDown={(e) => e.stopPropagation()}
        title={`Open ${view.label} below`}
        aria-label={`Open ${view.label} below`}
      >
        <SplitSquareVertical size={12} />
      </button>
    </Menu.Item>
  )
}
