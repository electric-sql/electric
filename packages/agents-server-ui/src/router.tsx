import { useCallback } from 'react'
import {
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { z } from 'zod'
import { usePinnedEntities } from './hooks/usePinnedEntities'
import {
  SidebarCollapsedProvider,
  useSidebarCollapsed,
} from './hooks/useSidebarCollapsed'
import { useHotkey } from './hooks/useHotkey'
import {
  SearchPaletteProvider,
  useSearchPalette,
} from './hooks/useSearchPalette'
import { WorkspaceProvider, useWorkspace } from './hooks/useWorkspace'
import { useWorkspaceHotkeys } from './hooks/useWorkspaceHotkeys'
import { useWorkspacePersistence } from './hooks/useWorkspacePersistence'
import { Sidebar } from './components/Sidebar'
import { SearchPalette } from './components/SearchPalette'
import { Workspace } from './components/workspace/Workspace'
import styles from './router.module.css'

function RootLayout(): React.ReactElement {
  return (
    <SidebarCollapsedProvider>
      <SearchPaletteProvider>
        <WorkspaceProvider>
          <RootShell />
        </WorkspaceProvider>
      </SearchPaletteProvider>
    </SidebarCollapsedProvider>
  )
}

function RootShell(): React.ReactElement {
  const { pinnedUrls, togglePin } = usePinnedEntities()
  const navigate = useNavigate()
  const { collapsed, toggle } = useSidebarCollapsed()
  const search = useSearchPalette()
  const { helpers } = useWorkspace()

  useHotkey(`mod+b`, toggle)
  useHotkey(`mod+k`, (e) => {
    e.preventDefault()
    search.toggle()
  })
  // New session: bind both ⌘N / Ctrl+N (works in Electron) and
  // ⌘⇧O / Ctrl+Shift+O (works in browsers — `⌘N` is reserved by
  // browsers for opening a new window and can't be intercepted, so
  // we fall back to a combo that isn't claimed by the chrome).
  // The displayed shortcut hint switches per environment via
  // `NewSessionKey` / `newSessionLabel`.
  //
  // Navigating to `/` is the simplest trigger: the URL → workspace
  // effect in `<Workspace>` then focuses an existing new-session
  // tile or replaces the active tile with a fresh one. Going through
  // the URL means the persistence layer sees the change too.
  const openNewSession = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault()
      navigate({ to: `/` })
    },
    [navigate]
  )
  useHotkey(`mod+n`, openNewSession)
  useHotkey(`mod+shift+o`, openNewSession)

  useWorkspaceHotkeys()
  useWorkspacePersistence()

  const navigateToEntity = useCallback(
    (entityUrl: string) => {
      navigate({
        to: `/entity/$`,
        params: { _splat: entityUrl.replace(/^\//, ``) },
      })
    },
    [navigate]
  )

  // ⌘/Ctrl-click + middle-click on a sidebar row → open the entity to
  // the right of the active tile, rather than replacing it (matches
  // VS Code's "open to side" gesture).
  const openEntityInSplit = useCallback(
    (entityUrl: string) => {
      const tileId = helpers.activeTileId
      if (!tileId) {
        // Empty workspace — fall through to plain navigation, which
        // will bootstrap the workspace's first tile.
        navigateToEntity(entityUrl)
        return
      }
      helpers.openEntity(entityUrl, {
        target: { tileId, position: `split-right` },
      })
    },
    [helpers, navigateToEntity]
  )

  const params = useParams({ strict: false })
  const splat = (params as Record<string, string | undefined>)._splat
  const selectedEntityUrl = splat ? `/${splat}` : null

  return (
    <div className={styles.appShell}>
      {!collapsed && (
        <Sidebar
          selectedEntityUrl={selectedEntityUrl}
          onSelectEntity={navigateToEntity}
          onOpenEntityInSplit={openEntityInSplit}
          pinnedUrls={pinnedUrls}
          onTogglePin={togglePin}
        />
      )}
      <Outlet />
      <SearchPalette />
    </div>
  )
}

/**
 * Search-param schema for the workspace routes.
 *
 * - `view`   optional view id (e.g. `state-explorer`). Omitted from
 *            the URL when it matches the default view (`chat`) so
 *            `/entity/foo` stays clean for the common case.
 * - `layout` optional shareable layout payload. When present we
 *            hydrate the workspace from it and *strip the param*
 *            (see `<Workspace>`'s ?layout effect) so the address bar
 *            settles back to "active tile only".
 *
 * Both index (`/`) and entity routes share this schema because both
 * accept `?layout=` (a layout link can land on either route — the
 * decoder restores the full tree regardless).
 */
const workspaceSearchSchema = z.object({
  view: z.string().optional(),
  layout: z.string().optional(),
})

/**
 * Thin route component — all the rendering work happens inside
 * `<Workspace>`, which reads the route params (entity splat + ?view)
 * via TanStack Router hooks and reflects them into the workspace
 * tree. Keeping the route handler this small means the component tree
 * underneath stays the same regardless of which entity is selected
 * (or whether the new-session tile is active), which lets per-tile
 * state (scroll, selection, etc.) survive navigation between tiles.
 */
function WorkspacePage(): React.ReactElement {
  return <Workspace />
}

const rootRoute = createRootRoute({ component: RootLayout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `/`,
  component: WorkspacePage,
  validateSearch: workspaceSearchSchema,
})

const entityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `/entity/$`,
  component: WorkspacePage,
  validateSearch: workspaceSearchSchema,
})

const routeTree = rootRoute.addChildren([indexRoute, entityRoute])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
})

// eslint-disable-next-line quotes
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
