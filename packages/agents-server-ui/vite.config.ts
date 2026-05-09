import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Tags the built `<html>` element with `data-electric-desktop="true"` for
 * the Electron desktop build so desktop-wide CSS matches from the first
 * paint. Platform-specific chrome rules use `data-electric-platform`, which
 * the Electron preload sets from the actual runtime platform; the static
 * `darwin` default avoids flashing Windows/Linux titlebar chrome on macOS
 * before preload runs.
 *
 * Local dev can opt into a desktop platform preview by setting
 * `ELECTRIC_DESKTOP_PREVIEW_PLATFORM` to `darwin` or `win32`.
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
  const previewPlatform = process.env.ELECTRIC_DESKTOP_PREVIEW_PLATFORM
  const previewDesktop =
    command === `serve` &&
    (previewPlatform === `darwin` || previewPlatform === `win32`)
  // Desktop *build* serves the bundle via file:// from the Electron
  // app, so assets must be referenced with relative URLs (`./`). The
  // dev server, on the other hand, serves over http and needs an
  // absolute base (`/`) for HMR and dynamic imports to resolve.
  const desktopServe = desktop && command === `serve`

  return {
    base: desktop ? (desktopServe ? `/` : `./`) : `/__agent_ui/`,
    plugins: [
      react(),
      ...(desktop
        ? [desktopHtmlMarker()]
        : previewDesktop
          ? [desktopHtmlMarker(previewPlatform)]
          : []),
    ],
    build: {
      outDir: desktop ? `dist-desktop` : `dist`,
      emptyOutDir: true,
    },
  }
})
