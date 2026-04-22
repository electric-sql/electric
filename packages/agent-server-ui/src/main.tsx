import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@radix-ui/themes/styles.css'
import './styles.css'
import { App } from './App'

const root = document.getElementById(`root`)

if (!root) {
  throw new Error(`Missing #root container`)
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
