import { defineConfig, type PluginOption } from 'vite'
import electron from 'vite-plugin-electron/simple'

const RENDERER_DEV_SERVER_URL = `http://localhost:5183`

/**
 * Treat any bare module specifier as external — i.e. let Node
 * resolve it from `node_modules` at runtime. This is the standard
 * pattern for Electron main / preload bundles:
 *
 *  - Avoids dragging optional native deps (jsdom → canvas, sharp,
 *    keytar, …) into the bundle and failing the build when they're
 *    not actually installed.
 *  - Keeps the bundled `main.js` small (just our own source) so any
 *    rebuild during dev stays sub-second.
 *  - Works in dev (workspace `node_modules` is symlinked) and in
 *    production (electron-builder ships the package's `node_modules`
 *    alongside the bundled main).
 *
 * Entry modules and any path-like import (relative, absolute) stay
 * internal so they actually get bundled.
 */
function externalizeBareImports(
  id: string,
  parent: string | undefined
): boolean {
  if (parent === undefined) return false
  if (id.startsWith(`.`)) return false
  if (id.startsWith(`/`) || /^[A-Za-z]:[\\/]/.test(id)) return false
  return true
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
              output: {
                entryFileNames: `main.js`,
                format: `es`,
                inlineDynamicImports: true,
              },
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
