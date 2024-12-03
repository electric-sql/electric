import './style.css'

import {
  CombineOnRead,
  OnlineWrites,
  OptimisticState,
  ThroughTheDB
} from '../../patterns'

const App = () => {
  return (
    <div className="app">
      <OnlineWrites />
      <OptimisticState />
      <CombineOnRead />
      <ThroughTheDB />
    </div>
  )
}

export default App
