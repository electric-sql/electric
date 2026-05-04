import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from 'react'
import type { Dispatch, ReactNode } from 'react'
import {
  workspaceReducer,
  findGroupContainingTile,
  findTile,
  listGroups,
} from '../lib/workspace/workspaceReducer'
import { EMPTY_WORKSPACE, dropPositionFromSplit } from '../lib/workspace/types'
import type {
  DropTarget,
  SplitDirection,
  Tile,
  Workspace,
} from '../lib/workspace/types'
import type { ViewId } from '../lib/workspace/viewRegistry'
import type { WorkspaceAction } from '../lib/workspace/workspaceReducer'

type WorkspaceContextValue = {
  workspace: Workspace
  dispatch: Dispatch<WorkspaceAction>
  /** Memoised helper API — wraps `dispatch` for ergonomics in components. */
  helpers: WorkspaceHelpers
}

export type WorkspaceHelpers = {
  /** Open `entityUrl` (with `viewId`) — defaults to active group, replace. */
  openEntity: (
    entityUrl: string,
    options?: { viewId?: ViewId; target?: DropTarget }
  ) => void
  /** Close a tile by id — collapses empty groups / splits. */
  closeTile: (tileId: string) => void
  /** Move a tile to a different position (drag-and-drop primitive). */
  moveTile: (tileId: string, target: DropTarget) => void
  /** Set a tile as active inside its group, plus mark its group active. */
  setActiveTile: (tileId: string) => void
  setActiveGroup: (groupId: string) => void
  /** Swap a tile's view in place — no layout change. */
  setTileView: (tileId: string, viewId: ViewId) => void
  /** Split the active tile and put the named view in the new group. */
  splitTileWithView: (
    tileId: string,
    viewId: ViewId,
    direction: SplitDirection
  ) => void
  /** Convenience: split the active tile, keeping the same view. */
  splitTile: (tileId: string, direction: SplitDirection) => void
  /** Resize a split's children. */
  resizeSplit: (splitId: string, sizes: Array<number>) => void
  /** Replace the entire workspace (used by URL/persistence hydration). */
  replaceWorkspace: (workspace: Workspace) => void

  // ---- Read-side conveniences (computed from the latest workspace). ----
  /** Active tile in the active group, or `null` for an empty workspace. */
  activeTile: Tile | null
  /** Active group, or `null` for an empty workspace. */
  activeGroupId: string | null
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({
  initial = EMPTY_WORKSPACE,
  children,
}: {
  initial?: Workspace
  children: ReactNode
}): React.ReactElement {
  const [workspace, dispatch] = useReducer(workspaceReducer, initial)

  const openEntity = useCallback<WorkspaceHelpers[`openEntity`]>(
    (entityUrl, options) => {
      dispatch({
        type: `open-tile`,
        tile: { entityUrl, viewId: options?.viewId ?? `chat` },
        target: options?.target,
      })
    },
    []
  )

  const closeTile = useCallback<WorkspaceHelpers[`closeTile`]>((tileId) => {
    dispatch({ type: `close-tile`, tileId })
  }, [])

  const moveTile = useCallback<WorkspaceHelpers[`moveTile`]>(
    (tileId, target) => {
      dispatch({ type: `move-tile`, tileId, target })
    },
    []
  )

  const setActiveTile = useCallback<WorkspaceHelpers[`setActiveTile`]>(
    (tileId) => {
      dispatch({ type: `set-active-tile`, tileId })
    },
    []
  )

  const setActiveGroup = useCallback<WorkspaceHelpers[`setActiveGroup`]>(
    (groupId) => {
      dispatch({ type: `set-active-group`, groupId })
    },
    []
  )

  const setTileView = useCallback<WorkspaceHelpers[`setTileView`]>(
    (tileId, viewId) => {
      dispatch({ type: `set-tile-view`, tileId, viewId })
    },
    []
  )

  const splitTileWithView = useCallback<WorkspaceHelpers[`splitTileWithView`]>(
    (tileId, viewId, direction) => {
      dispatch({ type: `split-tile-with-view`, tileId, viewId, direction })
    },
    []
  )

  const splitTile = useCallback<WorkspaceHelpers[`splitTile`]>(
    (tileId, direction) => {
      const tile = findTile(workspace.root, tileId)
      if (!tile) return
      dispatch({
        type: `split-tile-with-view`,
        tileId,
        viewId: tile.viewId,
        direction,
      })
    },
    [workspace.root]
  )

  const resizeSplit = useCallback<WorkspaceHelpers[`resizeSplit`]>(
    (splitId, sizes) => {
      dispatch({ type: `resize-split`, splitId, sizes })
    },
    []
  )

  const replaceWorkspace = useCallback<WorkspaceHelpers[`replaceWorkspace`]>(
    (next) => {
      dispatch({ type: `replace-workspace`, workspace: next })
    },
    []
  )

  const helpers = useMemo<WorkspaceHelpers>(() => {
    const groups = listGroups(workspace.root)
    const activeGroup =
      groups.find((g) => g.id === workspace.activeGroupId) ?? groups[0] ?? null
    const activeTile =
      activeGroup?.tiles.find((t) => t.id === activeGroup.activeTileId) ?? null
    return {
      openEntity,
      closeTile,
      moveTile,
      setActiveTile,
      setActiveGroup,
      setTileView,
      splitTileWithView,
      splitTile,
      resizeSplit,
      replaceWorkspace,
      activeTile,
      activeGroupId: workspace.activeGroupId,
    }
  }, [
    workspace,
    openEntity,
    closeTile,
    moveTile,
    setActiveTile,
    setActiveGroup,
    setTileView,
    splitTileWithView,
    splitTile,
    resizeSplit,
    replaceWorkspace,
  ])

  const value = useMemo<WorkspaceContextValue>(
    () => ({ workspace, dispatch, helpers }),
    [workspace, helpers]
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) {
    throw new Error(`useWorkspace must be called inside a <WorkspaceProvider>`)
  }
  return ctx
}

// Re-export tree walkers for convenience (some components call them
// against the snapshot returned from `useWorkspace`).
export { findGroupContainingTile, findTile, listGroups }
// Re-export the position helper so component-level imports stay shallow.
export { dropPositionFromSplit }
