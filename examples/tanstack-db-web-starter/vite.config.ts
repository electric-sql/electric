import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"
import { caddyPlugin } from "./src/vite-plugin-caddy"

const config = defineConfig({
  server: {
    host: true,
  },
  plugins: [
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: [`./tsconfig.json`],
    }),
    // Local HTTPS with Caddy
    caddyPlugin(),
    tailwindcss(),
    // TanStack Start must come before viteReact
    tanstackStart({
      srcDirectory: `src`,
      start: { entry: `./start.tsx` },
      server: { entry: `./server.ts` },
      router: {
        srcDirectory: `src`,
      },
      spa: {
        enabled: true,
      },
    }),
    viteReact(),
  ],
  ssr: {
    noExternal: [`zod`],
  },
})

export default config
