import {
  readdir,
  stat,
  copyFile,
  mkdir,
  rm,
  writeFile,
  readFile,
} from 'fs/promises'
import { join } from 'path'

const baseDir = new URL('.', import.meta.url).pathname
const templateDir = join(baseDir, 'template')
const exampleDir = join(baseDir, '..', 'web-wa-sqlite')
const templateOverlayDir = join(baseDir, 'template-overlay')

const ignoreDirs = ['node_modules', 'dist', 'generated', '.git']
const ignoreFiles = ['package-lock.json']

async function copyFiles(sourceDir, destinationDir) {
  try {
    const files = await readdir(sourceDir)

    for (const file of files) {
      const sourceFilePath = join(sourceDir, file)
      const destinationFilePath = join(destinationDir, file)

      const stats = await stat(sourceFilePath)

      if (stats.isFile()) {
        if (ignoreFiles.includes(file)) {
          continue
        }
        await copyFile(sourceFilePath, join(destinationDir, file))
      } else if (stats.isDirectory()) {
        if (ignoreDirs.includes(file)) {
          continue
        }
        await mkdir(destinationFilePath, { recursive: true })
        await copyFiles(sourceFilePath, destinationFilePath)
      }
    }
  } catch (err) {
    console.error('Error occurred:', err)
  }
}

try {
  await rm(templateDir, { recursive: true })
} catch (err) {
  // Already deleted
}
await mkdir(templateDir, { recursive: true })
await copyFiles(exampleDir, templateDir)
await copyFiles(templateOverlayDir, templateDir)

// change package name and version
const packageJsonPath = join(templateDir, 'package.json')
const packageJson = JSON.parse(
  await readFile(packageJsonPath, { encoding: 'utf-8' })
)
packageJson.name = 'my-electric-app'
packageJson.version = '0.1.0'
delete packageJson['license']
writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))
