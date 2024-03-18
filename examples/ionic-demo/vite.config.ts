/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  envPrefix: 'ELECTRIC_',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['wa-sqlite'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
})
