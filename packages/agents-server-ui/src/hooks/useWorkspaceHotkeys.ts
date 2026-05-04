import { useCallback } from 'react'
import { useHotkey } from './useHotkey'
import { useWorkspace, listGroups } from './useWorkspace'

const GROUP_FOCUS_INDICES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

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
 * - `⌘1..9`        Focus group N (1-indexed)
 * - `⌘\`           Cycle to the next group
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
    const groups = listGroups(workspace.root)
    if (groups.length < 2) return
    const currentIdx = groups.findIndex((g) => g.id === workspace.activeGroupId)
    const next = groups[(currentIdx + 1) % groups.length]
    helpers.setActiveGroup(next.id)
  })

  // The 9 group-focus hotkeys are registered as separate hook calls
  // (rather than a `for` loop) so the call count is statically obvious
  // — keeping React's rules-of-hooks happy without an eslint-disable.
  // Each handler closes over its own `n` via the const array above.
  const focusGroup = useCallback(
    (n: number, e: KeyboardEvent) => {
      const groups = listGroups(workspace.root)
      if (groups.length < n) return
      e.preventDefault()
      helpers.setActiveGroup(groups[n - 1].id)
    },
    [workspace.root, helpers]
  )
  useHotkey(`mod+${GROUP_FOCUS_INDICES[0]}`, (e) =>
    focusGroup(GROUP_FOCUS_INDICES[0], e)
  )
  useHotkey(`mod+${GROUP_FOCUS_INDICES[1]}`, (e) =>
    focusGroup(GROUP_FOCUS_INDICES[1], e)
  )
  useHotkey(`mod+${GROUP_FOCUS_INDICES[2]}`, (e) =>
    focusGroup(GROUP_FOCUS_INDICES[2], e)
  )
  useHotkey(`mod+${GROUP_FOCUS_INDICES[3]}`, (e) =>
    focusGroup(GROUP_FOCUS_INDICES[3], e)
  )
  useHotkey(`mod+${GROUP_FOCUS_INDICES[4]}`, (e) =>
    focusGroup(GROUP_FOCUS_INDICES[4], e)
  )
  useHotkey(`mod+${GROUP_FOCUS_INDICES[5]}`, (e) =>
    focusGroup(GROUP_FOCUS_INDICES[5], e)
  )
  useHotkey(`mod+${GROUP_FOCUS_INDICES[6]}`, (e) =>
    focusGroup(GROUP_FOCUS_INDICES[6], e)
  )
  useHotkey(`mod+${GROUP_FOCUS_INDICES[7]}`, (e) =>
    focusGroup(GROUP_FOCUS_INDICES[7], e)
  )
  useHotkey(`mod+${GROUP_FOCUS_INDICES[8]}`, (e) =>
    focusGroup(GROUP_FOCUS_INDICES[8], e)
  )
}
