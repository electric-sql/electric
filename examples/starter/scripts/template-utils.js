import {
  readdir,
  stat,
  access,
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
const ignoreDirs = [
  'node_modules',
  'dist',
  'generated',
  '.git',
  'ios',
  'android',
]
const ignoreFiles = ['package-lock.json', '.env']

/*
 * Replaces the first occurence of `find` by `replace` in the file `file`.
 * If `find` is a regular expression that sets the `g` flag, then it replaces all occurences.
 */
async function findAndReplaceInFile(find, replace, file) {
  const content = await readFile(file, 'utf8')
  const replacedContent = content.replace(find, replace)
  await writeFile(file, replacedContent)
}

/**
 * Modifies a JSON file with the given function
 *
 * @param {string} jsonFilePath path to the JSON file
 * @param {(any) => any} modify function that modifies the JSON
 */
async function modifyJsonFile(jsonFilePath, modify) {
  const parsedJson = JSON.parse(await readFile(jsonFilePath, 'utf8'))
  const modifiedJson = modify(parsedJson)
  await writeFile(jsonFilePath, JSON.stringify(modifiedJson, null, 2))
}

/**
 * Checks if a file or directory exists
 *
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false
    }
    throw err
  }
}

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
  templateOverlayDir,
) {
  try {
    await rm(templateTargetDir, { recursive: true })
  } catch (err) {
    // Already deleted
  }
  await mkdir(templateTargetDir, { recursive: true })
  await copyFiles(templateSourceDir, templateTargetDir)
  if (templateOverlayDir && (await pathExists(templateOverlayDir))) {
    await copyFiles(templateOverlayDir, templateTargetDir)
  }

  // npmjs.com seems to be removing .gitignore files from published packages.
  // Hance this renaming operation and a reverse operation in src/index.ts.
  await rename(
    join(templateTargetDir, '.gitignore'),
    join(templateTargetDir, 'dot_gitignore'),
  )

  // modify README file to have "starter template" title
  const readmeFile = join(templateTargetDir, 'README.md')
  await findAndReplaceInFile(
    /\n# (.+)\n/,
    '\n# Welcome to your ElectricSQL app!\n',
    readmeFile,
  )

  // change package.json name and version
  const packageJsonPath = join(templateTargetDir, 'package.json')
  await modifyJsonFile(packageJsonPath, (packageJson) => {
    packageJson.name = 'my-electric-app'
    packageJson.version = '0.1.0'
    delete packageJson['license']
    return packageJson
  })

  // change app.json name if present (Expo and RN only)
  const appJsonPath = join(templateTargetDir, 'app.json')
  if (await pathExists(appJsonPath)) {
    await modifyJsonFile(appJsonPath, (appJson) => {
      // for Expo app.json
      if ('expo' in appJson) {
        appJson.expo.name = 'my-electric-app'
        appJson.expo.slug = 'My Electric App'
        delete appJson.expo['owner']
      }

      // for React Native app.json
      if ('name' in appJson) {
        appJson.name = 'MyElectricApp'
        appJson.displayName = 'My Electric App'
      }
      return appJson
    })
  }
}

export { copyTemplateOverlayFiles }
