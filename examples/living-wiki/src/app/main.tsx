import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { router } from './router'
import './styles/globals.css'

const rootElement = document.getElementById(`root`)

if (!rootElement) {
  throw new Error(`Root element #root was not found`)
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
