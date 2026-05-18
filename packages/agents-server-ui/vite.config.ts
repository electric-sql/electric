import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))
const localNodeModules = (...segments: Array<string>): string =>
  path.resolve(PACKAGE_DIR, `node_modules`, ...segments)

/**
 * Tags the built `<html>` element with `data-electric-desktop="true"` for
 * the Electron desktop build so desktop-wide CSS matches from the first
 * paint. Platform-specific chrome rules use `data-electric-platform`, which
 * the Electron preload sets from the actual runtime platform; the static
 * `darwin` default avoids flashing Windows/Linux titlebar chrome on macOS
 * before preload runs.
 */
function desktopHtmlMarker(platform: `darwin` | `win32` = `darwin`): Plugin {
  return {
    name: `electric-desktop-html-marker`,
    transformIndexHtml: {
      order: `pre`,
      handler(html) {
        return html.replace(
          `<html lang="en">`,
          `<html lang="en" data-electric-desktop="true" data-electric-platform="${platform}">`
        )
      },
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const desktop = mode === `desktop`
  // Desktop *build* serves the bundle via file:// from the Electron
  // app, so assets must be referenced with relative URLs (`./`). The
  // dev server, on the other hand, serves over http and needs an
  // absolute base (`/`) for HMR and dynamic imports to resolve.
  const desktopServe = desktop && command === `serve`

  return {
    base: desktop ? (desktopServe ? `/` : `./`) : `/__agent_ui/`,
    plugins: [react(), ...(desktop ? [desktopHtmlMarker()] : [])],
    resolve: {
      alias: {
        react: localNodeModules(`react`),
        'react-dom': localNodeModules(`react-dom`),
        'react/jsx-runtime': localNodeModules(`react`, `jsx-runtime.js`),
        'react/jsx-dev-runtime': localNodeModules(
          `react`,
          `jsx-dev-runtime.js`
        ),
      },
      dedupe: [`react`, `react-dom`, `@tanstack/db`],
    },
    optimizeDeps: {
      exclude: [`@durable-streams/state`, `@tanstack/db`, `@tanstack/react-db`],
      include: [
        `react`,
        `react-dom`,
        `react/jsx-runtime`,
        `react/jsx-dev-runtime`,
      ],
    },
    build: {
      outDir: desktop ? `dist-desktop` : `dist`,
      emptyOutDir: true,
    },
  }
})
