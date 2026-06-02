import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    proxy: {
      '/api': `http://localhost:8787`,
      '/trpc': `http://localhost:8787`,
    },
  },
  build: {
    outDir: `dist/client`,
    emptyOutDir: true,
  },
})
