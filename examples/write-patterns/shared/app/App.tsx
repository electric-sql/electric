import "./style.css"

import {
  OnlineWrites,
  OptimisticState,
  SharedPersistent,
  ThroughTheDB,
} from "../../patterns"

const App = () => {
  return (
    <div className="app">
      <OnlineWrites />
      <OptimisticState />
      <SharedPersistent />
      <ThroughTheDB />
    </div>
  )
}

export default App
