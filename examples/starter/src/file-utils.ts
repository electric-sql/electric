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
 * Replaces the package.json file with the given project name
 * @param projectDir path to the project directory
 */
async function replacePackageJson(
  projectDir: string,
  options: Pick<CLIOptions, 'appName'>
) {
  // read package.json file and parse it as JSON
  // we could import it but then we get a warning
  // that importing JSON is an experimental feature
  // we can hide that warning using the --no-warnings flag
  // with nodeJS but the parsing of that flag
  // leads to problems on certain env implementations
  const packageJsonFile = path.join(projectDir, 'package.json')
  const projectPackageJson = JSON.parse(
    await fs.readFile(packageJsonFile, 'utf8')
  )

  // Update the project's package.json with the new project name
  projectPackageJson.name = options.appName

  await fs.writeFile(
    packageJsonFile,
    JSON.stringify(projectPackageJson, null, 2)
  )
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
