import { useCallback, useEffect } from 'react'
import {
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useLocation,
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
import {
  WorkspaceProvider,
  useWorkspace,
  listTiles,
} from './hooks/useWorkspace'
import { useWorkspaceHotkeys } from './hooks/useWorkspaceHotkeys'
import { useWorkspacePersistence } from './hooks/useWorkspacePersistence'
import { useDocumentTitle } from './hooks/useDocumentTitle'
import { Sidebar } from './components/Sidebar'
import { SearchPalette } from './components/SearchPalette'
import { Workspace } from './components/workspace/Workspace'
import { ApiKeysModal } from './components/ApiKeysModal'
import {
  SettingsSidebar,
  type SettingsCategoryId,
} from './components/settings/SettingsSidebar'
import { GeneralPage } from './components/settings/pages/GeneralPage'
import { AppearancePage } from './components/settings/pages/AppearancePage'
import { LocalRuntimePage } from './components/settings/pages/LocalRuntimePage'
import styles from './router.module.css'

const SETTINGS_CATEGORY_IDS: ReadonlyArray<SettingsCategoryId> = [
  `general`,
  `appearance`,
  `local-runtime`,
]

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
  const { workspace, helpers } = useWorkspace()

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
  const openNewSession = useCallback(() => {
    navigate({ to: `/` })
  }, [navigate])
  useHotkey(`mod+n`, (e) => {
    e.preventDefault()
    openNewSession()
  })
  useHotkey(`mod+shift+o`, (e) => {
    e.preventDefault()
    openNewSession()
  })

  useWorkspaceHotkeys()
  useWorkspacePersistence()
  useDocumentTitle()

  // In Electron, the application menu and tray fire `desktop:command`
  // IPC events that map 1:1 to the actions above. Subscribing here
  // means menu items, on-screen buttons and keyboard shortcuts share
  // the same code path — the menu is just another invocation channel.
  useEffect(() => {
    const off = window.electronAPI?.onDesktopCommand?.((command) => {
      switch (command) {
        case `new-chat`:
          openNewSession()
          break
        case `toggle-sidebar`:
          toggle()
          break
        case `open-search`:
          search.toggle()
          break
        case `close-tile`: {
          const id = helpers.activeTile?.id
          if (id) helpers.closeTile(id)
          break
        }
        case `split-right`: {
          const id = helpers.activeTile?.id
          if (id) helpers.splitTile(id, `right`)
          break
        }
        case `split-down`: {
          const id = helpers.activeTile?.id
          if (id) helpers.splitTile(id, `down`)
          break
        }
        case `cycle-tile`: {
          const tiles = listTiles(workspace.root)
          if (tiles.length < 2) break
          const currentIdx = tiles.findIndex(
            (t) => t.id === workspace.activeTileId
          )
          const next = tiles[(currentIdx + 1) % tiles.length]
          if (next) helpers.setActiveTile(next.id)
          break
        }
      }
    })
    return () => off?.()
  }, [openNewSession, toggle, search, helpers, workspace])

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

  // Settings is its own sidebar — when the user navigates into
  // `/settings/*` we swap the workspace sidebar (sessions list) for
  // a settings-categories sidebar so the settings experience reads
  // as part of the same shell rather than a modal overlay. The
  // `<Outlet>` component rendered to the right comes from whichever
  // route matched, so the right column behaves the same way for
  // both the workspace and settings routes.
  const location = useLocation()
  const settingsCategory = parseSettingsCategory(location.pathname)
  const inSettings = settingsCategory !== null

  return (
    <div className={styles.appShell}>
      {inSettings ? (
        <SettingsSidebar activeCategory={settingsCategory} />
      ) : (
        !collapsed && (
          <Sidebar
            selectedEntityUrl={selectedEntityUrl}
            onSelectEntity={navigateToEntity}
            onOpenEntityInSplit={openEntityInSplit}
            pinnedUrls={pinnedUrls}
            onTogglePin={togglePin}
          />
        )
      )}
      <Outlet />
      <SearchPalette />
      <ApiKeysModal />
    </div>
  )
}

/**
 * Read the active settings category off the URL.
 *
 * Returns the category id when the user is on `/settings/<category>`,
 * `null` otherwise. We hand-parse instead of using `useParams` because
 * `RootShell` lives above the routes and doesn't have a strict route
 * context to type-narrow against.
 */
function parseSettingsCategory(pathname: string): SettingsCategoryId | null {
  const match = pathname.match(/^\/settings\/([^/?]+)/)
  if (!match) return null
  const id = match[1] as SettingsCategoryId
  return SETTINGS_CATEGORY_IDS.includes(id) ? id : null
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

/**
 * Settings shell — `/settings` redirects to the default category so
 * the user always lands inside a populated panel rather than an empty
 * shell. Each child route renders one category's screen on the right
 * while `RootShell` swaps in the settings sidebar on the left.
 */
const settingsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `/settings`,
  beforeLoad: () => {
    throw redirect({
      to: `/settings/$category`,
      params: { category: `general` },
    })
  },
  component: () => null,
})

const settingsCategoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `/settings/$category`,
  component: SettingsCategoryPage,
})

function SettingsCategoryPage(): React.ReactElement {
  const params = useParams({ strict: false }) as Record<
    string,
    string | undefined
  >
  switch (params.category as SettingsCategoryId | undefined) {
    case `appearance`:
      return <AppearancePage />
    case `local-runtime`:
      return <LocalRuntimePage />
    case `general`:
    default:
      return <GeneralPage />
  }
}

const routeTree = rootRoute.addChildren([
  indexRoute,
  entityRoute,
  settingsIndexRoute,
  settingsCategoryRoute,
])

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
