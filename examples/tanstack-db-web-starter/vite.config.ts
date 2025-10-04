import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"
import multiPortPlugin from "./src/lib/vite-plugin-multi-port"

// [51730..51779]
const shardPorts = Array.from({ length: 25 }, (_, i) => 51730 + i)

const config = defineConfig(({ mode }) => ({
  define: {
    '__ELECTRIC_SHARD_PORTS__': mode !== 'production' ? JSON.stringify(shardPorts) : 'undefined',
  },
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
    // cors: {
    //   origin: true,
    //   allowedHeaders: ['Content-Type', 'Authorization'],
    // },
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
      srcDirectory: 'src',
      start: { entry: './start.tsx' },
      server: { entry: './server.ts' },
      router: {
        srcDirectory: 'src',
      },
      spa: {
        enabled: true,
      },
    }),
    viteReact(),
    // Also bind to a range of other ports to avoid HTTP/1 concurrent request
    // limits blocking shapes in local development. This avoids needing to
    // run over HTTP/2, which is the proper solution in production.
    ...(mode !== 'production' ? [multiPortPlugin(shardPorts)] : [])
  ],
  ssr: {
    noExternal: ["zod"],
  },
}))

export default config
