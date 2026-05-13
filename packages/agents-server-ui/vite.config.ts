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
    resolve: {
      alias: [
        {
          find: /^@electric-ax\/agents-runtime\/client$/,
          replacement: path.resolve(
            PACKAGE_DIR,
            `../agents-runtime/src/client.ts`
          ),
        },
        {
          find: /^react$/,
          replacement: localNodeModules(`react`),
        },
        {
          find: /^react-dom$/,
          replacement: localNodeModules(`react-dom`),
        },
        {
          find: /^react\/jsx-runtime$/,
          replacement: localNodeModules(`react`, `jsx-runtime.js`),
        },
        {
          find: /^react\/jsx-dev-runtime$/,
          replacement: localNodeModules(`react`, `jsx-dev-runtime.js`),
        },
      ],
      dedupe: [`react`, `react-dom`],
    },
    plugins: [react(), ...(desktop ? [desktopHtmlMarker()] : [])],
    optimizeDeps: {
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
