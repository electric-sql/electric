import { useHotkey } from './useHotkey'
import { useWorkspace, listTiles } from './useWorkspace'

/**
 * Workspace-level keyboard shortcuts. Mounted once near the top of the
 * tree (inside `WorkspaceProvider`) so they're active on every screen.
 *
 * The keymap mirrors the on-screen menu items in `<SplitMenu>` so users
 * who learn one channel can use the other.
 *
 * - `⌘D`           Split active tile right
 * - `⇧⌘D`          Split active tile down
 * - `⌘W`           Close active tile
 * - `⌘\`           Cycle to the next tile (tree order)
 *
 * Hotkeys are skipped when focus is in a text input (handled by
 * `useHotkey`'s default `ignoreInputs: true` behaviour).
 */
export function useWorkspaceHotkeys(): void {
  const { workspace, helpers } = useWorkspace()

  useHotkey(`mod+d`, (e) => {
    if (!helpers.activeTile) return
    e.preventDefault()
    helpers.splitTile(helpers.activeTile.id, `right`)
  })

  useHotkey(`mod+shift+d`, (e) => {
    if (!helpers.activeTile) return
    e.preventDefault()
    helpers.splitTile(helpers.activeTile.id, `down`)
  })

  useHotkey(`mod+w`, (e) => {
    if (!helpers.activeTile) return
    e.preventDefault()
    helpers.closeTile(helpers.activeTile.id)
  })

  useHotkey(`mod+\\`, (e) => {
    e.preventDefault()
    const tiles = listTiles(workspace.root)
    if (tiles.length < 2) return
    const currentIdx = tiles.findIndex((t) => t.id === workspace.activeTileId)
    const next = tiles[(currentIdx + 1) % tiles.length]
    helpers.setActiveTile(next.id)
  })
}
