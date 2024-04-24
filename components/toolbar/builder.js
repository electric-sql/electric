import { build } from 'esbuild'
import inlineImage from 'esbuild-plugin-inline-image'
import inlineImport from 'esbuild-plugin-inline-import'
import packageJson from './package.json' assert { type: 'json' }
const { dependencies } = packageJson

const entryFile = 'src/index.tsx'
const shared = {
  bundle: true,
  entryPoints: [entryFile],
  // Treat all dependencies in package.json as externals to keep bundle size to a minimum
  external: Object.keys(dependencies),
  logLevel: 'info',
  minify: true,
  sourcemap: true,
  target: ['esnext', 'node12.22.0'],
  plugins: [
    inlineImage(),
    inlineImport({
      transform: (content) => {
        // Remove comments
        content = content.replace(/\/\*[\s\S]*?\*\//g, '')
        // Remove whitespace and newlines
        content = content.replace(/\n/g, '').replace(/\s\s+/g, ' ')
        return content
      },
    }),
  ],
}

build({
  ...shared,
  format: 'esm',
  outfile: './dist/index.esm.js',
})

build({
  ...shared,
  format: 'cjs',
  outfile: './dist/index.cjs.js',
})
