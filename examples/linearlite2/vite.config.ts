import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import griffel from '@griffel/vite-plugin'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    TanStackRouterVite({ target: `react`, autoCodeSplitting: true }),
    react(),
    command === 'build' && griffel(),
  ],
}))
