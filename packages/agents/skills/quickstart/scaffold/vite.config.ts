import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: `ui`,
  plugins: [react()],
  resolve: {
    alias: {
      '@tanstack/db': path.resolve(
        import.meta.dirname,
        `node_modules/@tanstack/db`
      ),
    },
  },
  server: {
    port: 5175,
    proxy: { '/api': `http://localhost:3000` },
  },
  build: { outDir: `../dist`, emptyOutDir: true },
})
