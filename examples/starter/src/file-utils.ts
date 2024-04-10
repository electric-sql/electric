import * as fs from 'fs/promises'
import path from 'path'
import { CLIOptions } from './input'
import { spawn } from 'child_process'
import { getTemplateDirectory } from './templates'

/*
 * Replaces the first occurence of `find` by `replace` in the file `file`.
 * If `find` is a regular expression that sets the `g` flag, then it replaces all occurences.
 */
async function findAndReplaceInFile(
  find: string | RegExp,
  replace: string,
  file: string
) {
  const content = await fs.readFile(file, 'utf8')
  const replacedContent = content.replace(find, replace)
  await fs.writeFile(file, replacedContent)
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
 * Modifies the package.json file to use the given project name
 *
 * @param projectDir path to the project directory
 * @param options options object containing 'appName'
 */
async function modifyPackageJson(
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

/**
 * Modifies the Expo app.json file to use the given project name and slug
 *
 * @param projectDir path to the project directory
 * @param options options object containing 'appName'
 */
async function modifyExpoAppJson(
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

/**
 * Modifies the README file to have "starter template" title
 *
 * @param projectDir path to the project directory
 */
async function modifyReadmeFile(projectDir: string) {
  const readmeFile = path.join(projectDir, 'README.md')
  await findAndReplaceInFile(
    /^#[\w\s]+$/,
    '# Welcome to your ElectricSQL app!',
    readmeFile
  )
}

/**
 * Renames the "dot_gitignore" file to ".gitignore" in the
 * specified project directory - this is required for npmjs.com
 * as they seem to remove .gitignore files from published packages
 * so we rename it to dot_gitignore and then rename it back
 *
 * @param projectDir the directory path where the files are located.
 */
async function renameDotIgnoreFile(projectDir: string) {
  await fs.rename(
    path.join(projectDir, 'dot_gitignore'),
    path.join(projectDir, '.gitignore')
  )
}

/**
 * Create a .env.local file with specified configuration
 *
 * @param projectDir the directory where the file will be created
 * @param options the options used to determine env vars to include
 */
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
 * Modifies template files based on the provided project directory and CLI options.
 * Performs various operations like renaming configuration and README files.
 *
 * @param projectDir the directory of the project
 * @param options the options for the command-line interface
 */
export async function modifyTemplateFiles(
  projectDir: string,
  options: CLIOptions
) {
  await renameDotIgnoreFile(projectDir)
  await modifyReadmeFile(projectDir)
  await generateEnvFile(projectDir, options)

  // currently all templates have a package.json, so modify here
  // instead of in the switch template
  await modifyPackageJson(projectDir, options)

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
      await modifyExpoAppJson(projectDir, options)
      break
  }
}

/**
 * Asynchronously installs dependencies for a project directory.
 *
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
