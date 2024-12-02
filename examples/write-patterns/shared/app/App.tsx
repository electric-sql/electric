import './style.css'

import { CombineOnRead, OnlineWrites, OptimisticState } from '../../patterns'

const App = () => {
  return (
    <div className="app">
      <OnlineWrites />
      <OptimisticState />
      <CombineOnRead />
      <div className="example"></div>
    </div>
  )
}

export default App
