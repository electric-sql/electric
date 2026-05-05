import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type PluginOption } from 'vite'
import electron from 'vite-plugin-electron/simple'

const RENDERER_DEV_SERVER_URL = `http://localhost:5183`
const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(PACKAGE_DIR, `../..`)

const MUST_EXTERNALIZE = new Set([
  `electron`,
  `better-sqlite3`,
  `sqlite-vec`,
  `canvas`,
  `bufferutil`,
  `utf-8-validate`,
  `jsdom`,
  `pino`,
  `pino-pretty`,
])

function externalizeBareImports(
  id: string,
  parent: string | undefined
): boolean {
  if (parent === undefined) return false
  if (MUST_EXTERNALIZE.has(id)) return true
  const pkgName = id.startsWith(`@`)
    ? id.split(`/`).slice(0, 2).join(`/`)
    : id.split(`/`)[0]
  if (MUST_EXTERNALIZE.has(pkgName)) return true
  if (id.includes(`node_modules`)) {
    const match = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
    if (match && MUST_EXTERNALIZE.has(match[1])) return true
  }
  return false
}

// vite-plugin-electron ships its own bundled `Plugin` type derived
// from a different vite/@types/node peer combination than the one
// pnpm hoists for us, so the literal return type fails structural
// equality with our vite. The plugin works correctly at runtime —
// cast through `unknown` to silence the dual-instance noise.
const electronPlugin = electron as unknown as (
  options: Parameters<typeof electron>[0]
) => PluginOption

/**
 * Vite config for the Electron app's main + preload bundles.
 *
 * The renderer is its own Vite project (`agents-server-ui`) — this
 * config is only responsible for compiling the Node-side `main.ts`
 * and `preload.ts`, and for managing the Electron child process in
 * dev mode.
 *
 * Dev (`vite`):
 *  - `vite-plugin-electron/simple` builds main + preload in watch
 *    mode and spawns Electron once the initial build completes.
 *  - On any subsequent rebuild it restarts the Electron child with
 *    proper debouncing — no manual `electronmon` loop.
 *  - The renderer is loaded from `RENDERER_DEV_SERVER_URL` (the
 *    parallel `agents-server-ui` dev server, started by the `dev`
 *    script via `concurrently`). We export the URL into the env so
 *    the spawned Electron process picks it up in `main.ts`.
 *  - The host Vite dev server itself is unused — the renderer lives
 *    in another package — so we bind it to a random port and
 *    suppress the auto-open behaviour.
 *
 * Build (`vite build`):
 *  - Builds main + preload to `dist/`. The renderer is built
 *    separately by `agents-server-ui`'s `build:desktop` script.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@electric-ax/agents': path.resolve(
        REPO_ROOT,
        `packages/agents/src/index.ts`
      ),
      '@electric-ax/agents-runtime': path.resolve(
        REPO_ROOT,
        `packages/agents-runtime/src/index.ts`
      ),
      '@electric-ax/agents-runtime/tools': path.resolve(
        REPO_ROOT,
        `packages/agents-runtime/src/tools.ts`
      ),
    },
  },
  server: {
    port: 0,
    strictPort: false,
    open: false,
  },
  plugins: [
    electronPlugin({
      main: {
        entry: `src/main.ts`,
        onstart({ startup }) {
          // Inherits the parent process env, so setting it here lets
          // `main.ts` read `process.env.ELECTRIC_DESKTOP_DEV_SERVER_URL`
          // and load the renderer from the Vite dev server instead of
          // the prebuilt `dist-desktop/index.html`.
          process.env.ELECTRIC_DESKTOP_DEV_SERVER_URL = RENDERER_DEV_SERVER_URL
          void startup()
        },
        vite: {
          build: {
            outDir: `dist`,
            emptyOutDir: false,
            sourcemap: `inline`,
            minify: false,
            rollupOptions: {
              external: externalizeBareImports,
              output: [
                {
                  entryFileNames: `main.cjs`,
                  format: `cjs`,
                  inlineDynamicImports: true,
                },
              ],
            },
          },
        },
      },
      preload: {
        input: `src/preload.ts`,
        vite: {
          build: {
            outDir: `dist`,
            emptyOutDir: false,
            sourcemap: `inline`,
            minify: false,
            rollupOptions: {
              external: externalizeBareImports,
              output: {
                entryFileNames: `preload.cjs`,
                format: `cjs`,
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
    }),
  ],
})
