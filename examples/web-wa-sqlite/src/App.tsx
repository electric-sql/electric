import logo from './assets/logo.svg'
import './App.css'
import './style.css'

import { ElectricProvider } from './ElectricProvider'
import { Example } from './Example'

export default function App() {
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <ElectricProvider>
          <Example />
        </ElectricProvider>
      </header>
    </div>
  )
}
