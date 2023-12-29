import { resolve } from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// https://vitejs.dev/config/
export default defineConfig({
  envPrefix: 'ELECTRIC_',
  build: {
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'electric-sql-nodejs-sidecar',
      // the proper extensions will be added
      fileName: 'electric-sql-nodejs-sidecar',
    },
  },
  plugins: [dts()],
})