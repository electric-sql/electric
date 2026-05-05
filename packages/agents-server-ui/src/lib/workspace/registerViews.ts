import { Database, MessageSquare, SquarePen } from 'lucide-react'
import { registerView } from './viewRegistry'
import { NEW_SESSION_VIEW_ID } from './types'
import { ChatView } from '../../components/views/ChatView'
import { StateExplorerView } from '../../components/views/StateExplorerView'
import { NewSessionView } from '../../components/views/NewSessionView'

/**
 * Register all built-in views. Imported once from `main.tsx` so the
 * side-effect runs before the app mounts.
 *
 * Order matters for entity views: it controls the order of items in
 * the View section of the tile menu, the icon-strip in the tile
 * header, and the default view when an entity is opened (first
 * registered entity view is the default).
 */
registerView({
  kind: `entity`,
  id: `chat`,
  label: `Chat`,
  icon: MessageSquare,
  description: `Conversation timeline and message composer`,
  Component: ChatView,
})

registerView({
  kind: `entity`,
  id: `state-explorer`,
  label: `State Explorer`,
  icon: Database,
  description: `Inspect shared state and the event log`,
  Component: StateExplorerView,
})

/**
 * Standalone view: "new session". Doesn't belong to an entity, so it
 * never appears in the per-entity view-switcher. The workspace mounts
 * a tile with this view as its empty state and to host the new-session
 * picker (which can be split / dragged like any other tile).
 */
registerView({
  kind: `standalone`,
  id: NEW_SESSION_VIEW_ID,
  label: `New session`,
  icon: SquarePen,
  description: `Pick an agent type to start a new session`,
  Component: NewSessionView,
})

/** No-op export so the file is treated as a module by `import './registerViews'`. */
export const VIEWS_REGISTERED = true
