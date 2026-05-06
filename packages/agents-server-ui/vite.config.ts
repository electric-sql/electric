import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { viteSingleFile } from 'vite-plugin-singlefile'

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
        }
      : {}),
    resolve: {
      alias: [
        {
          find: /^@electric-ax\/agents-runtime\/client$/,
          replacement: resolve(__dirname, `../agents-runtime/src/client.ts`),
        },
        ...(mobileEmbed
          ? [
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
            ]
          : []),
      ],
    },
    plugins: [
      react(),
      ...(desktop ? [desktopHtmlMarker()] : []),
      // Mobile embed inlines all JS + CSS into a single HTML so the
      // React Native side can ship one self-contained string.
      ...(mobileEmbed
        ? [viteSingleFile({ removeViteModuleLoader: true })]
        : []),
    ],
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
      dedupe: [`react`, `react-dom`],
    },
    optimizeDeps: {
      include: [
        `react`,
        `react-dom`,
        `react/jsx-runtime`,
        `react/jsx-dev-runtime`,
      ],
    },
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
