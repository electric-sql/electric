import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, `./`),
    },
  },
  root: path.resolve(__dirname),
  server: {
    proxy: {
      "/api/operation": {
        target: `http://localhost:3002`,
        // changeOrigin: true,
      },
      "/shape-proxy": {
        target: `http://localhost:3002`,
        // changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, `../../dist/static_site`),
    sourcemap: true,
  },
})
