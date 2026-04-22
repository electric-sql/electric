import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: `/__agent_ui/`,
  plugins: [react()],
  build: {
    outDir: `dist`,
    emptyOutDir: true,
  },
})
