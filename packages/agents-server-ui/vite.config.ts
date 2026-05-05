import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Tags the built `<html>` element with `data-electric-desktop="true"`
 * for the Electron desktop build so module-CSS rules like
 * `:global(html[data-electric-desktop='true']) .header` match from the
 * first paint — earlier than either preload (isolated world) or the
 * renderer entry (runs after CSS is loaded) can reliably set the
 * attribute.
 */
function desktopHtmlMarker(): Plugin {
  return {
    name: `electric-desktop-html-marker`,
    transformIndexHtml: {
      order: `pre`,
      handler(html) {
        return html.replace(
          `<html lang="en">`,
          `<html lang="en" data-electric-desktop="true">`
        )
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const desktop = mode === `desktop`

  return {
    base: desktop ? `./` : `/__agent_ui/`,
    plugins: [react(), ...(desktop ? [desktopHtmlMarker()] : [])],
    build: {
      outDir: desktop ? `dist-desktop` : `dist`,
      emptyOutDir: true,
    },
  }
})
