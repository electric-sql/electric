import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const tanstackDbPath = path.resolve(
  import.meta.dirname,
  `node_modules/@tanstack/db`
)

export default defineConfig({
  root: `src/ui`,
  plugins: [react()],
  resolve: {
    alias: {
      '@tanstack/db': tanstackDbPath,
    },
  },
  server: {
    port: 5175,
    open: false,
    proxy: {
      '/api': `http://localhost:4700`,
    },
  },
  build: {
    outDir: `../../dist`,
    emptyOutDir: true,
  },
})
