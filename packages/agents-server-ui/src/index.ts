import './styles.css'

export { App } from './App'

export {
  ServerConnectionProvider,
  useServerConnection,
} from './hooks/useServerConnection'
export {
  ElectricAgentsProvider,
  useElectricAgents,
} from './lib/ElectricAgentsProvider'
export type {
  ElectricEntity,
  ElectricEntityType,
} from './lib/ElectricAgentsProvider'
export { useEntityTimeline } from './hooks/useEntityTimeline'

export { Sidebar } from './components/Sidebar'
export { EntityTimeline } from './components/EntityTimeline'
export { EntityHeader } from './components/EntityHeader'
export { MessageInput } from './components/MessageInput'
export { ServerPicker } from './components/ServerPicker'
export { StatusDot } from './components/StatusDot'

export { getEntityInstanceName } from './lib/types'
export type { ServerConfig, PublicEntity, EntityType } from './lib/types'
