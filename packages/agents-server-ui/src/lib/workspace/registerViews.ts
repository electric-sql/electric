import { Database, MessageSquare } from 'lucide-react'
import { registerView } from './viewRegistry'
import { ChatView } from '../../components/views/ChatView'
import { StateExplorerView } from '../../components/views/StateExplorerView'

/**
 * Register all built-in views. Imported once from `main.tsx` so the
 * side-effect runs before the app mounts.
 *
 * Order matters: it controls the order of items in the `View ▸` submenu
 * and the default tab when an entity is opened (first registered view
 * is the default).
 */
registerView({
  id: `chat`,
  label: `Chat`,
  icon: MessageSquare,
  description: `Conversation timeline and message composer`,
  Component: ChatView,
})

registerView({
  id: `state-explorer`,
  label: `State Explorer`,
  icon: Database,
  description: `Inspect shared state and the event log`,
  // Match today's UX: clicking the parent menu row pops it out to the
  // right, just like the old drawer.
  defaultSplit: `right`,
  Component: StateExplorerView,
})

/** No-op export so the file is treated as a module by `import './registerViews'`. */
export const VIEWS_REGISTERED = true
