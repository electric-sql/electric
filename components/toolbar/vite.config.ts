import * as path from 'path'
import { defineConfig } from 'vite'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), cssInjectedByJsPlugin()],
  build: {
    sourcemap: true,
    minify: true,
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: path.resolve(__dirname, 'src/index.tsx'),
      name: '@electric-sql/debug-toolbar',
      // the proper extensions will be added
      fileName: 'index',
    },
  },
})
