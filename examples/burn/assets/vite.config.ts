// import { writeFileSync } from 'fs'
// import { join } from 'path'
// type Plugin
import { defineConfig, loadEnv } from 'vite'
import griffel from '@griffel/vite-plugin'
import react from '@vitejs/plugin-react'

import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isProd = mode === 'production'

  return {
    build: {
      outDir: '../priv/static',
      target: ['es2022'],
      minify: isProd,
      sourcemap: !isProd,
      rollupOptions: {
        input: 'src/app.tsx',
        output: {
          assetFileNames: 'assets/[name][extname]',
          chunkFileNames: 'assets/chunk/[name].js',
          entryFileNames: 'assets/[name].js',
        },
      },
    },
    define: {
      __APP_ENV__: env.APP_ENV,
      // Explicitly force production React
      'process.env.NODE_ENV': JSON.stringify(
        isProd ? 'production' : 'development'
      ),
      'import.meta.env.PROD': isProd,
      'import.meta.env.DEV': !isProd,
    },
    plugins: [
      TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
      react(),
      command === 'build' && griffel(),
    ],
    publicDir: false,
  }
})
