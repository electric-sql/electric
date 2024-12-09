import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 ** 2,
      },
      devOptions: {
        enabled: false,
      },
      includeAssets: ['shared/app/icons/*'],
      manifest: {
        name: 'Write Patterns Example - ElectricSQL ',
        short_name: 'Writes',
        description: 'Four different write-patterns that work with Electric.',
        theme_color: '#1c1e20',
        icons: [
          {
            src: './shared/app/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: './shared/app/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
})
