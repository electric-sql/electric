import { defineConfig } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'

// https://vitejs.dev/config/
export default defineConfig({
  envPrefix: 'ELECTRIC_',
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        svgo: true,
        plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
        svgoConfig: {
          plugins: [
            'preset-default',
            'removeTitle',
            'removeDesc',
            'removeDoctype',
            'cleanupIds',
          ],
        },
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      },
    },
  },
})
