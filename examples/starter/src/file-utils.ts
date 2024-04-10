import * as fs from 'fs/promises'
import path from 'path'
import { CLIOptions } from './input'
import { spawn } from 'child_process'
import { getTemplateDirectory } from './templates'

/*
 * Replaces the first occurence of `find` by `replace` in the file `file`.
 * If `find` is a regular expression that sets the `g` flag, then it replaces all occurences.
 */
export async function findAndReplaceInFile(
  find: string | RegExp,
  replace: string,
  file: string
) {
  const content = await fs.readFile(file, 'utf8')
  const replacedContent = content.replace(find, replace)
  await fs.writeFile(file, replacedContent)
}

/**
 * Generate a project from a template.
 *
 * @param currentDir - the current directory
 * @param templatesParentDir - the parent directory for templates
 * @param options - options object containing 'appName' and 'templateType'
 * @return the path to the generated project
 */
export async function generateProjectFromTemplate(
  currentDir: string,
  templatesParentDir: string,
  options: Pick<CLIOptions, 'appName' | 'templateType'>
): Promise<string> {
  const projectDir = path.resolve(currentDir, options.appName)
  await fs.mkdir(projectDir, { recursive: true })

  // Copy the app template to the project's directory
  const templateDir = path.join(
    templatesParentDir,
    getTemplateDirectory(options.templateType)
  )
  await fs.cp(templateDir, projectDir, { recursive: true })
  return projectDir
}

/**
 * Modifies a JSON file with the given function
 *
 * NOTE: importing JSON files is an experimental feature
 * and it's not guaranteed to work on all env implementations
 * which is we we opt for this approach
 *
 * @param jsonFilePath path to the JSON file
 * @param modify function that modifies the JSON
 */
async function modifyJsonFile(
  jsonFilePath: string,
  modify: (json: any) => any
) {
  const parsedJson = JSON.parse(await fs.readFile(jsonFilePath, 'utf8'))
  const modifiedJson = modify(parsedJson)
  await fs.writeFile(jsonFilePath, JSON.stringify(modifiedJson, null, 2))
}

/**
 * Replaces the package.json file with the given project name
 * @param projectDir path to the project directory
 */
async function replacePackageJson(
  projectDir: string,
  options: Pick<CLIOptions, 'appName'>
) {
  const packageJsonFile = path.join(projectDir, 'package.json')
  await modifyJsonFile(packageJsonFile, (packageJson) => {
    // Update the project's package.json with the new project name
    packageJson.name = options.appName
    return packageJson
  })
}

async function replaceExpoAppJson(
  projectDir: string,
  options: Pick<CLIOptions, 'appName'>
) {
  const expoAppJsonFile = path.join(projectDir, 'app.json')
  await modifyJsonFile(expoAppJsonFile, (expoAppJson) => {
    // Update the project's app.json with the new project name
    expoAppJson.name = options.appName

    // Update the slug, making sure it's in the right format
    expoAppJson.slug = options.appName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')

    // Remove any "owner" property
    delete expoAppJson.owner

    return expoAppJson
  })
}

async function renameDotIgnoreFile(projectDir: string) {
  await fs.rename(
    path.join(projectDir, 'dot_gitignore'),
    path.join(projectDir, '.gitignore')
  )
}

async function generateEnvFile(
  projectDir: string,
  options: Pick<CLIOptions, 'electricPort' | 'electricProxyPort'>
) {
  // Create a .env.local file with specified or default options
  await fs.writeFile(
    path.join(projectDir, '.env.local'),
    [
      `ELECTRIC_PORT=${options.electricPort}`,
      `ELECTRIC_PROXY_PORT=${options.electricProxyPort}`,
    ].join('\n')
  )
}

export async function modifyTemplateFiles(
  projectDir: string,
  options: CLIOptions
) {
  await renameDotIgnoreFile(projectDir)
  await generateEnvFile(projectDir, options)

  // currently all templates have a package.json, so modify here
  await replacePackageJson(projectDir, options)

  switch (options.templateType) {
    case 'react':
    case 'vue':
      // Update the project's title in the index.html file
      const indexFile = path.join(projectDir, 'index.html')
      await findAndReplaceInFile(
        'Web Example - ElectricSQL',
        options.appName,
        indexFile
      )
      break

    case 'expo':
      await replaceExpoAppJson(projectDir, options)
      break
  }
}

/**
 * Asynchronously installs dependencies for a project directory.
 * @param projectDir the directory path of the project
 */
export async function installDependencies(projectDir: string): Promise<void> {
  return new Promise<void>((res, rej) => {
    // Run `npm install` in the project directory to install the dependencies
    // Also run `npm upgrade` to replace `electric-sql: latest` by `electric-sql: x.y.z`
    // where `x.y.z` corresponds to the latest version.
    const proc = spawn('npm install && npm upgrade --caret electric-sql', [], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: projectDir,
      shell: true,
    })

    let errors: Uint8Array[] = []
    proc.stderr.on('data', (data) => {
      errors = errors.concat(data)
    })

    proc.on('close', async (code) => {
      if (code === 0) {
        res()
      } else {
        const errStr = Buffer.concat(errors).toString()
        rej(errStr)
      }
    })
  })
}
