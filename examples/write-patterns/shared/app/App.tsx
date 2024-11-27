import './style.css'

import { OnlineWrites } from '../../patterns'
import { OptimisticState } from '../../patterns'

const App = () => {
  return (
    <div className="app">
      <OnlineWrites />
      <OptimisticState />
      <div className="example"></div>
      <div className="example"></div>
    </div>
  )
}

export default App
