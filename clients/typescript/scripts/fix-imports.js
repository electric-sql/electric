import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

// https://gist.github.com/lovasoa/8691344
async function* walk(dir) {
  for await (const d of await fs.promises.opendir(dir)) {
    const entry = path.join(dir, d.name)
    if (d.isDirectory()) {
      yield* walk(entry)
    } else if (d.isFile()) {
      yield entry
    }
  }
}

function resolveImportPath(sourceFile, importPath, options) {
  const sourceFileAbs = path.resolve(process.cwd(), sourceFile)
  const root = path.dirname(sourceFileAbs)
  const { moduleFilter = defaultModuleFilter } = options

  if (moduleFilter(importPath)) {
    const importPathAbs = path.resolve(root, importPath)
    let possiblePath = [
      path.resolve(importPathAbs, './index.ts'),
      path.resolve(importPathAbs, './index.js'),
      importPathAbs + '.ts',
      importPathAbs + '.js',
    ]

    if (possiblePath.length) {
      for (let i = 0; i < possiblePath.length; i++) {
        let entry = possiblePath[i]
        if (fs.existsSync(entry)) {
          const resolved = path.relative(root, entry.replace(/\.ts$/, '.js'))

          if (!resolved.startsWith('.')) {
            return './' + resolved
          }

          return resolved
        }
      }
    }
  }

  return null
}

function replace(filePath, outFilePath, options) {
  const code = fs.readFileSync(filePath).toString()
  let logging = false
  const newCode = code.replace(
    /(import|export) (.+?) from ('[^\n']+'|"[^\n"]+")(;|\n)/gs,
    (found, action, imported, from, end) => {
      const importPath = from.slice(1, -1)
      const resolvedPath = resolveImportPath(filePath, importPath, options)

      if (resolvedPath) {
        if (!logging) {
          logging = true
          console.log(filePath)
        }
        console.log('\t', importPath, resolvedPath)
        return `${action} ${imported} from '${resolvedPath}'${end}`
      }

      return found
    }
  )

  if (code !== newCode) {
    fs.writeFileSync(outFilePath, newCode)
  }
}

// Then, use it with a simple async for loop
async function run(srcDir, options = defaultOptions) {
  const { sourceFileFilter = defaultSourceFileFilter } = options

  for await (const entry of walk(srcDir)) {
    if (sourceFileFilter(entry)) {
      replace(entry, entry, options)
    }
  }
}

const defaultSourceFileFilter = (sourceFilePath) => {
  return (
    /\.(js|ts)$/.test(sourceFilePath) && !/node_modules/.test(sourceFilePath)
  )
}

const defaultModuleFilter = (importedModule) => {
  return (
    !path.isAbsolute(importedModule) &&
    !importedModule.startsWith('@') &&
    !importedModule.endsWith('.js')
  )
}

const defaultOptions = {
  sourceFileFilter: defaultSourceFileFilter,
  moduleFilter: defaultModuleFilter,
}

const distDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist'
)
if (fs.existsSync(distDir)) {
  await run(distDir, defaultOptions)
}
