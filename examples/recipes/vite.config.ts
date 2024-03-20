import { defineConfig } from 'vite'

import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  envPrefix: 'ELECTRIC_',
  optimizeDeps: {
    // disable optimization for demo mode to resolve issues
    // when running in Web Containers
    ...(mode === 'demo'
      ? {
          noDiscovery: true,
          include: [],
        }
      : {}),
    exclude: ['wa-sqlite'],
  },
}))
