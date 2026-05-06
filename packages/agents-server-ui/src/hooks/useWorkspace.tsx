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
  findTile,
  listTiles,
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
  helpers: WorkspaceHelpers
}

export type WorkspaceHelpers = {
  /** Open `entityUrl` (with `viewId`) — defaults to replacing the active tile. */
  openEntity: (
    entityUrl: string,
    options?: { viewId?: ViewId; target?: DropTarget }
  ) => void
  /**
   * Open a standalone "new session" tile — defaults to replacing the
   * active tile. Used by the index route, the `⌘N` hotkey and the
   * sidebar's "New session" button. Pass an explicit `target` to put
   * the new-session tile in a split instead.
   */
  openNewSession: (options?: { target?: DropTarget }) => void
  /** Close a tile by id — collapses parent splits if needed. */
  closeTile: (tileId: string) => void
  /** Move a tile to a different position (drag-and-drop primitive). */
  moveTile: (tileId: string, target: DropTarget) => void
  /** Mark a tile as the active tile (drives URL sync + ⌘W target). */
  setActiveTile: (tileId: string) => void
  /** Swap a tile's view in place — preserves tile id (and per-tile state). */
  setTileView: (tileId: string, viewId: ViewId) => void
  /** Split a tile and put a different view in the new tile. */
  splitTileWithView: (
    tileId: string,
    viewId: ViewId,
    direction: SplitDirection
  ) => void
  /** Convenience: split a tile, copying its current view into the new one. */
  splitTile: (tileId: string, direction: SplitDirection) => void
  resizeSplit: (splitId: string, sizes: Array<number>) => void
  replaceWorkspace: (workspace: Workspace) => void

  // ---- Read-side conveniences (computed from the latest workspace). ----
  /** The active tile, or `null` for an empty workspace. */
  activeTile: Tile | null
  activeTileId: string | null
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

  const openNewSession = useCallback<WorkspaceHelpers[`openNewSession`]>(
    (options) => {
      dispatch({ type: `open-new-session-tile`, target: options?.target })
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
    const activeTile =
      (workspace.activeTileId &&
        findTile(workspace.root, workspace.activeTileId)) ||
      listTiles(workspace.root)[0] ||
      null
    return {
      openEntity,
      openNewSession,
      closeTile,
      moveTile,
      setActiveTile,
      setTileView,
      splitTileWithView,
      splitTile,
      resizeSplit,
      replaceWorkspace,
      activeTile,
      activeTileId: workspace.activeTileId,
    }
  }, [
    workspace,
    openEntity,
    openNewSession,
    closeTile,
    moveTile,
    setActiveTile,
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

export { findTile, listTiles }
export { dropPositionFromSplit }
