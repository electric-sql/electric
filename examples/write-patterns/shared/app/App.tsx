import './style.css'

import { OnlineWrites } from '../../patterns'

const App = () => {
  return (
    <div className="app">
      <OnlineWrites />
      <OnlineWrites />
      <div className="example"></div>
      <div className="example"></div>
    </div>
  )
}

export default App
