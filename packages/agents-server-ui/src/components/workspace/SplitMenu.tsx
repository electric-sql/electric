import { useMemo, useState } from 'react'
import {
  ChevronRight,
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
import { useWorkspace } from '../../hooks/useWorkspace'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { usePinnedEntities } from '../../hooks/usePinnedEntities'
import { listViews } from '../../lib/workspace/viewRegistry'
import { encodeLayout } from '../../lib/workspace/layoutCodec'
import { Button, Dialog, IconButton, Menu, Stack, Text } from '../../ui'
import { modKeyLabel } from '../../lib/keyLabels'
import { getEntityDisplayTitle } from '../../lib/entityDisplay'
import type { ElectricEntity } from '../../lib/ElectricAgentsProvider'
import type { Tile, SplitDirection } from '../../lib/workspace/types'
import styles from './SplitMenu.module.css'

const SPLIT_DIRECTIONS: ReadonlyArray<{
  dir: SplitDirection
  label: string
  shortcut?: string
}> = [
  { dir: `right`, label: `Split right`, shortcut: modKeyLabel(`d`) },
  {
    dir: `down`,
    label: `Split down`,
    shortcut: modKeyLabel({ letter: `d`, shift: true }),
  },
  { dir: `left`, label: `Split left` },
  { dir: `up`, label: `Split up` },
]

/**
 * Per-tile workspace menu. Shown in the tile header (replacing the
 * old "more actions" menu) and contains:
 *
 * - **View ▸ {viewId}**            switch the active tile's view in
 *                                  place; each leaf is itself a sub-menu
 *                                  with `Open here / Split right / Split
 *                                  down / Split left / Split up`.
 * - **Split right / down / left / up** duplicates the active tile into a
 *                                       new group split in that direction.
 * - **Copy URL · Pin · Fork · Kill** entity-level actions, mirroring the
 *                                    actions previously surfaced from
 *                                    `EntityHeader`.
 * - **Close tile / Close group**  layout cleanup.
 *
 * Splitting and view-switching share two primitives — `setTileView` and
 * `splitTileWithView` — so every menu item composes from those.
 */
export function SplitMenu({
  tile,
  groupId,
  entity,
}: {
  tile: Tile
  groupId: string
  entity: ElectricEntity
}): React.ReactElement {
  const { workspace, helpers } = useWorkspace()
  const { forkEntity, killEntity } = useElectricAgents()
  const { pinnedUrls, togglePin } = usePinnedEntities()
  const navigate = useNavigate()
  const pinned = pinnedUrls.includes(tile.entityUrl)
  const [showInspect, setShowInspect] = useState(false)
  const [showKillConfirm, setShowKillConfirm] = useState(false)
  const { title: instanceName } = getEntityDisplayTitle(entity)

  // Look up the group's siblings to enable "Move tile to → Group N".
  const groups = useMemo(() => {
    const out: Array<{ id: string; idx: number }> = []
    if (!workspace.root) return out
    const collect = (node: typeof workspace.root, idx = { n: 0 }): void => {
      if (!node) return
      if (node.kind === `group`) {
        out.push({ id: node.id, idx: ++idx.n })
      } else {
        for (const c of node.children) collect(c.node, idx)
      }
    }
    collect(workspace.root)
    return out
  }, [workspace.root])
  const otherGroups = groups.filter((g) => g.id !== groupId)
  const groupCount = groups.length

  const handleSplit = (dir: SplitDirection) => {
    helpers.splitTile(tile.id, dir)
  }

  const availableViews = listViews(entity)

  const handleFork = () => {
    if (!forkEntity) return
    void forkEntity(tile.entityUrl)
      .then((root) =>
        navigate({
          to: `/entity/$`,
          params: { _splat: root.url.replace(/^\//, ``) },
        })
      )
      .catch(() => {})
  }

  const handleKill = () => {
    if (!killEntity) return
    const tx = killEntity(tile.entityUrl)
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

  return (
    <Menu.Root>
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
        <Menu.Item onSelect={() => setShowInspect(true)}>
          <Eye size={14} />
          <Text size={2}>Inspect</Text>
        </Menu.Item>

        <Menu.Separator />

        {/* ---- View ▸ ----------------------------------------------- */}
        <Menu.SubmenuRoot>
          <Menu.SubmenuTrigger className={styles.subTrigger}>
            <Text size={2}>View</Text>
            <span className={styles.subChevron} aria-hidden="true">
              <ChevronRight size={14} />
            </span>
          </Menu.SubmenuTrigger>
          <Menu.Content side="right" align="start">
            {availableViews.map((view) => {
              const Icon = view.icon
              return (
                <ViewSubmenu
                  key={view.id}
                  label={view.label}
                  icon={<Icon size={14} />}
                  description={view.description}
                  defaultSplit={view.defaultSplit}
                  isActive={view.id === tile.viewId}
                  onOpenHere={() => helpers.setTileView(tile.id, view.id)}
                  onSplit={(dir) =>
                    helpers.splitTileWithView(tile.id, view.id, dir)
                  }
                />
              )
            })}
          </Menu.Content>
        </Menu.SubmenuRoot>

        <Menu.Separator />

        {/* ---- Split current tile ----------------------------------- */}
        {SPLIT_DIRECTIONS.map(({ dir, label, shortcut }) => (
          <Menu.Item key={dir} onSelect={() => handleSplit(dir)}>
            {dir === `right` || dir === `left` ? (
              <SplitSquareHorizontal size={14} />
            ) : (
              <SplitSquareVertical size={14} />
            )}
            <Text size={2}>{label}</Text>
            {shortcut && <span className={styles.shortcut}>{shortcut}</span>}
          </Menu.Item>
        ))}

        {/* ---- Move tile to → another group ------------------------- */}
        {otherGroups.length > 0 && (
          <>
            <Menu.Separator />
            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger className={styles.subTrigger}>
                <Text size={2}>Move tile to</Text>
                <span className={styles.subChevron} aria-hidden="true">
                  <ChevronRight size={14} />
                </span>
              </Menu.SubmenuTrigger>
              <Menu.Content side="right" align="start">
                {otherGroups.map((g) => (
                  <Menu.Item
                    key={g.id}
                    onSelect={() =>
                      helpers.moveTile(tile.id, {
                        groupId: g.id,
                        position: `append`,
                      })
                    }
                  >
                    <Text size={2}>Group {g.idx}</Text>
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.SubmenuRoot>
          </>
        )}

        <Menu.Separator />

        {/* ---- Entity actions --------------------------------------- */}
        <Menu.Item
          onSelect={() => {
            void navigator.clipboard.writeText(tile.entityUrl)
          }}
        >
          <Copy size={14} />
          <Text size={2}>Copy URL</Text>
        </Menu.Item>
        <Menu.Item onSelect={handleCopyLayoutLink}>
          <Link2 size={14} />
          <Text size={2}>Copy layout link</Text>
        </Menu.Item>
        <Menu.Item onSelect={() => togglePin(tile.entityUrl)}>
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          <Text size={2}>{pinned ? `Unpin` : `Pin`}</Text>
        </Menu.Item>
        {forkEntity && !entity.parent && (
          <Menu.Item
            onSelect={handleFork}
            disabled={entity.status === `stopped`}
          >
            <GitFork size={14} />
            <Text size={2}>Fork subtree</Text>
          </Menu.Item>
        )}

        <Menu.Separator />

        {/* ---- Layout cleanup --------------------------------------- */}
        <Menu.Item
          onSelect={() => helpers.closeTile(tile.id)}
          tone={groupCount === 1 ? `default` : `default`}
        >
          <X size={14} />
          <Text size={2}>Close tile</Text>
          <span className={styles.shortcut}>{modKeyLabel(`w`)}</span>
        </Menu.Item>

        {entity.status !== `stopped` && killEntity && (
          <>
            <Menu.Separator />
            <Menu.Item onSelect={() => setShowKillConfirm(true)} tone="danger">
              <Trash2 size={14} />
              <Text size={2}>Kill entity</Text>
            </Menu.Item>
          </>
        )}
      </Menu.Content>

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
    </Menu.Root>
  )
}

function ViewSubmenu({
  label,
  icon,
  description,
  defaultSplit,
  isActive,
  onOpenHere,
  onSplit,
}: {
  label: string
  icon: React.ReactNode
  description?: string
  defaultSplit?: `right` | `down`
  isActive: boolean
  onOpenHere: () => void
  onSplit: (dir: SplitDirection) => void
}): React.ReactElement {
  // Clicking the parent row directly dispatches the view's preferred
  // action — `defaultSplit` if it's set, else "open here". This is what
  // makes `View ▸ State Explorer` keep the "drawer pops out to the right"
  // muscle-memory without forcing the user into the deeper menu.
  const onParentSelect = () => {
    if (defaultSplit) onSplit(defaultSplit)
    else onOpenHere()
  }

  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger
        className={styles.subTrigger}
        onClick={onParentSelect}
      >
        {icon}
        <Text size={2}>{label}</Text>
        {isActive && (
          <span className={styles.shortcut} aria-label="active view">
            ✓
          </span>
        )}
        <span className={styles.subChevron} aria-hidden="true">
          <ChevronRight size={14} />
        </span>
      </Menu.SubmenuTrigger>
      <Menu.Content side="right" align="start">
        {description && (
          <Menu.Label>
            <Text size={1} tone="muted">
              {description}
            </Text>
          </Menu.Label>
        )}
        <Menu.Item onSelect={onOpenHere} disabled={isActive}>
          <Text size={2}>Open here</Text>
        </Menu.Item>
        <Menu.Separator />
        {([`right`, `down`, `left`, `up`] as const).map((dir) => (
          <Menu.Item key={dir} onSelect={() => onSplit(dir)}>
            <Text size={2}>Split {dir}</Text>
            {dir === defaultSplit && (
              <span className={styles.shortcut}>default</span>
            )}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.SubmenuRoot>
  )
}
