import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"
import trustedHttps from "@electric-sql/vite-plugin-trusted-https"

const config = defineConfig(({ command }) => {
  const isDevServer = command === "serve"

  return {
    plugins: [
      viteTsConfigPaths({
        projects: ["./tsconfig.json"],
      }),
      tailwindcss(),
      tanstackStart({
        spa: {
          enabled: true,
        },
      }),
      ...(isDevServer ? [trustedHttps()] : []),
    ],
    ssr: {
      noExternal: ["zod"],
    },
  }
})

export default config
