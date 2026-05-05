import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

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

export default defineConfig(({ command, mode }) => {
  const desktop = mode === `desktop`
  const mobileEmbed = mode === `mobile-embed`
  // Desktop *build* serves the bundle via file:// from the Electron
  // app, so assets must be referenced with relative URLs (`./`). The
  // dev server, on the other hand, serves over http and needs an
  // absolute base (`/`) for HMR and dynamic imports to resolve.
  const desktopServe = desktop && command === `serve`

  return {
    base: desktop ? (desktopServe ? `/` : `./`) : `/__agent_ui/`,
    // Mobile embed needs the file-name prefix preserved on CSS module
    // class names so the embed's mobile-only override sheet (which
    // targets selectors like `[class*='EntityTimeline_content']`) can
    // pin point individual rules from the desktop component sheets.
    // Vite's default production hash (`_[local]_[hash]_[counter]`) drops
    // the file name; restore it so the embed overrides keep matching
    // across rebuilds.
    ...(mobileEmbed
      ? {
          css: {
            modules: {
              generateScopedName: `[name]_[local]_[hash:base64:5]`,
            },
          },
          // Heavy markdown deps (`mermaid` ~5 MB, `shiki` ~3.8 MB,
          // `katex` ~600 KB, `@streamdown/math` pulls katex) get
          // swapped for tiny stubs in `src/embed/stubs/`. Mobile chat
          // shows code as plain monospace and skips math/diagrams,
          // which trims the embed bundle from ~13 MB to ~3 MB.
          resolve: {
            alias: [
              {
                find: `mermaid`,
                replacement: resolve(__dirname, `src/embed/stubs/mermaid.ts`),
              },
              {
                find: /^shiki\/bundle\/web$/,
                replacement: resolve(__dirname, `src/embed/stubs/shiki.ts`),
              },
              {
                find: /^katex$/,
                replacement: resolve(__dirname, `src/embed/stubs/katex.ts`),
              },
              {
                find: /^@streamdown\/math$/,
                replacement: resolve(
                  __dirname,
                  `src/embed/stubs/streamdown-math.ts`
                ),
              },
            ],
          },
        }
      : {}),
    plugins: [
      react(),
      ...(desktop ? [desktopHtmlMarker()] : []),
      // Mobile embed inlines all JS + CSS into a single HTML so the
      // React Native side can ship one self-contained string.
      ...(mobileEmbed
        ? [viteSingleFile({ removeViteModuleLoader: true })]
        : []),
    ],
    build: {
      outDir: mobileEmbed
        ? `dist-mobile-embed`
        : desktop
          ? `dist-desktop`
          : `dist`,
      emptyOutDir: true,
      // Use `embed.html` as the lone entry for the mobile-embed bundle
      // so the regular `index.html` (workspace shell) is excluded.
      ...(mobileEmbed
        ? {
            rollupOptions: {
              input: { index: resolve(__dirname, `embed.html`) },
            },
            // Keep things in a single chunk for the singlefile inliner.
            assetsInlineLimit: 100 * 1024 * 1024,
            chunkSizeWarningLimit: 100 * 1024,
            cssCodeSplit: false,
          }
        : {}),
    },
  }
})
