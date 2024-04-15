import {
  readdir,
  stat,
  copyFile,
  mkdir,
  rename,
  rm,
  writeFile,
  readFile,
} from 'fs/promises'
import { join } from 'path'

// do not copy over the following files and directories when
// copying the template directories
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

/**
 * Copies the files from the template source directory to the template target directory,
 * and optionally adds files from the template overlay directory.
 *
 * @param {string} templateSourceDir - the source directory for the template
 * @param {string} templateTargetDir - where to copy the template to
 * @param {string} templateOverlayDir - optional "overlay" template to overwrite source
 */
async function copyTemplateOverlayFiles(
  templateSourceDir,
  templateTargetDir,
  templateOverlayDir
) {
  try {
    await rm(templateTargetDir, { recursive: true })
  } catch (err) {
    // Already deleted
  }
  await mkdir(templateTargetDir, { recursive: true })
  await copyFiles(templateSourceDir, templateTargetDir)
  if (templateOverlayDir) {
    await copyFiles(templateOverlayDir, templateTargetDir)
  }

  // npmjs.com seems to be removing .gitignore files from published packages.
  // Hance this renaming operation and a reverse operation in src/index.ts.
  await rename(
    join(templateTargetDir, '.gitignore'),
    join(templateTargetDir, 'dot_gitignore')
  )

  // change package name and version
  const packageJsonPath = join(templateTargetDir, 'package.json')
  const packageJson = JSON.parse(
    await readFile(packageJsonPath, { encoding: 'utf-8' })
  )
  packageJson.name = 'my-electric-app'
  packageJson.version = '0.1.0'
  delete packageJson['license']
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))
}

export { copyTemplateOverlayFiles }
