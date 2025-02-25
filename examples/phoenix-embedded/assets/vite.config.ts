import { defineConfig } from "vite"
import react from "@vitejs/plugin-react-swc"

export default defineConfig({
  build: {
    outDir: "../priv/static",
    emptyOutDir: false,
    target: ["es2020"],
    manifest: false,
    rollupOptions: {
      input: "js/main.tsx",
      output: {
        assetFileNames: "assets/[name][extname]",
        chunkFileNames: "[name].js",
        entryFileNames: "assets/[name].js",
      },
    },
  },
  plugins: [react()],
})
