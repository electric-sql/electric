import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  envPrefix: 'ELECTRIC_',
  define: {
    __BACKEND_URL__: JSON.stringify('http://localhost:40001'),
    __DEBUG_MODE__: true,
    __ELECTRIC_URL__: JSON.stringify('ws://localhost:5133'),
    __SANITISED_DATABASE_URL__: JSON.stringify('dummy'),
  },
  optimizeDeps: {
    exclude: ['wa-sqlite'],
  },
})
