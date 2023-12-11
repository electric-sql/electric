import logo from './assets/electric_logo.svg'
import { ElectricWrapper } from './electric/ElectricWrapper'

function App() {
  return (
    <ElectricWrapper>
      <div>
        <a href="https://electric-sql.com" target="_blank" rel="noreferrer">
          <img src={logo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
    </ElectricWrapper>
  )
}

export default App
