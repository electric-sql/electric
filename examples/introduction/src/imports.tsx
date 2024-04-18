export { DndProvider } from 'react-dnd'
export { HTML5Backend } from 'react-dnd-html5-backend'
export { TouchBackend } from 'react-dnd-touch-backend'

// Aggregate the imports needed for all the demos here.
// This allows the documentation to import them easily.
export { useConnectivityState, useLiveQuery } from 'electric-sql/react'
export { QualifiedTablename, genUUID } from 'electric-sql/util'

export { default as api } from './api'
export * from './components'
export { useElectric } from './electric'
export {
  boostrapPlayers,
  boostrapSlider,
  boostrapTournament,
  useDemoContext,
} from './session'
export { timeResolution } from './util'

export type { Demo, Item, Player, Slider, Tournament } from './electric'
