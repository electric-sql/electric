#!/usr/bin/env node

// Usage: npx create-electric-app@latest my-app

import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'
import ora from 'ora'
import shell from 'shelljs'
import portUsed from 'tcp-port-used'
import prompt from 'prompt'

// Regex to check that a number is between 0 and 65535
const portRegex = /^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/
const spinner = ora('Validating arguments').start()

const error = (err: string) => {
  spinner.stop()
  console.error('\x1b[31m', err + '\nnpx create-electric-app [<app-name>] [--electric-port <port>] [--webserver-port <port>]')
  process.exit(1)
}

let projectName = process.argv[2]
let args = process.argv.slice(3)
let electricPort = 5133 // default port for Electric
let webserverPort = 3001 // default port for the webserver

// Validate the provided command line arguments
while (args.length > 0) {
  // There are arguments to parse
  const flag = args[0]
  const value = args[1]

  args = args.slice(2)

  const checkValue = () => {
    if (typeof value === 'undefined') {
      error(`Missing value for option '${flag}'.`)
    }
  }

  switch (flag) {
    case '--electric-port':
      checkValue()
      electricPort = parsePort(value)
      break
    case '--webserver-port':
      checkValue()
      webserverPort = parsePort(value)
      break
    default:
      error(`Unrecognized option: '${flag}'.`)
  }
}

spinner.text = 'Validating app name'

if (typeof projectName === 'undefined') {
  // no project name is provided -> enter prompt mode
  spinner.stop()
  prompt.start()
  const userInput = (await prompt.get({
    properties: {
      appName: {
        description: 'App name',
        type: 'string',
        // Validate the project name to follow
        // the restrictions for Docker compose project names.
        // cf. https://docs.docker.com/compose/environment-variables/envvars/
        // Because we will use the app name
        // as the Docker compose project name.
        pattern: /^[a-z0-9]+[a-z0-9-_]*$/,
        message: `Invalid app name. ` +
          'App names must contain only lowercase letters, decimal digits, dashes, and underscores, ' +
          'and must begin with a lowercase letter or decimal digit.',
        required: true,
      },
      electricPort: {
        description: 'Port on which to run Electric',
        type: 'number',
        pattern: portRegex,
        message: 'Port should be between 0 and 65535.',
        default: electricPort
      },
      webserverPort: {
        description: 'Port on which to run the webserver',
        type: 'number',
        pattern: portRegex,
        message: 'Port should be between 0 and 65535.',
        default: webserverPort
      },
    }
  })) as { appName: string, electricPort: number, webserverPort: number }

  spinner.start()
  projectName = userInput.appName
  electricPort = userInput.electricPort
  webserverPort = userInput.webserverPort
}

spinner.text = 'Ensuring the necessary ports are free'

electricPort = await checkPort(electricPort, 'Electric', 5133)
webserverPort = await checkPort(webserverPort, 'the web server', 3001)

spinner.text = 'Creating project structure'
spinner.start()

// Create a project directory with the project name
const currentDir = process.cwd()
const projectDir = path.resolve(currentDir, projectName)
await fs.mkdir(projectDir, { recursive: true })

// Copy the app template to the project's directory
const __dirname = path.dirname(fileURLToPath(import.meta.url)) // because __dirname is not defined when using modules
const templateDir = path.resolve(__dirname, '..', 'template')
await fs.cp(templateDir, projectDir, { recursive: true })

// The template stores dotfiles without the dot
// such that they do not get picked by gitignore.
// Now that we copies all files, we rename those
// dotfiles to their right name
await fs.rename(
  path.join(projectDir, 'dot_gitignore'),
  path.join(projectDir, '.gitignore')
)
await fs.rename(
  path.join(projectDir, 'dot_npmrc'),
  path.join(projectDir, '.npmrc')
)
const envrcFile = path.join(projectDir, 'backend', 'compose', '.envrc')
await fs.rename(
  path.join(projectDir, 'backend', 'compose', 'dot_envrc'),
  envrcFile
)

// read package.json file and parse it as JSON
// we could import it but then we get a warning
// that importing JSON is an experimental feature
// we can hide that warning using the --no-warnings flag
// with nodeJS but the parsing of that flag
// leads to problems on certain env implementations
const packageJsonFile = path.join(projectDir, 'package.json')
const projectPackageJson = JSON.parse(await fs.readFile(packageJsonFile, 'utf8'))

// Update the project's package.json with the new project name
projectPackageJson.name = projectName

await fs.writeFile(
  packageJsonFile,
  JSON.stringify(projectPackageJson, null, 2).replace('http://localhost:5133', `http://localhost:${electricPort}`)
)

// Update the project's title in the index.html file
const indexFile = path.join(projectDir, 'public', 'index.html')
await findAndReplaceInFile('ElectricSQL starter template', projectName, indexFile)

// Update the port on which Electric runs in the builder.js file
const builderFile = path.join(projectDir, 'builder.js')
await findAndReplaceInFile('5133', `${electricPort}`, builderFile)

// Update the port on which Electric runs in startElectric.js file
const startElectricFile = path.join(projectDir, 'backend', 'startElectric.js')
await findAndReplaceInFile('5133', `${electricPort}`, startElectricFile)

// Update the port of the web server of the example in the builder.js file
await findAndReplaceInFile(/3001/g, `${webserverPort}`, builderFile)

// Store the app's name in .envrc
// db name must start with a letter
// and contain only alphanumeric characters and underscores
// so we let the name start at the first letter
// and replace non-alphanumeric characters with _
const name = projectName.match(/[a-zA-Z].*/)?.[0] // strips prefix of non-alphanumeric characters
if (name) {
  const dbName = name.replace(/[\W_]+/g, '_')
  await fs.appendFile(envrcFile, `export APP_NAME=${dbName}\n`)
}

// Also write the port for Electric to .envrc
await fs.appendFile(envrcFile, `export ELECTRIC_PORT=${electricPort}\n`)

// Run `yarn install` in the project directory to install the dependencies
// Also run `yarn upgrade` to replace `electric-sql: latest` by `electric-sql: x.y.z`
// where `x.y.z` corresponds to the latest version.
// Same for `@electric-sql/prisma-generator`
spinner.text = 'Installing dependencies (may take some time) ...'
const proc = spawn(
  'yarn install && yarn upgrade --exact electric-sql && yarn upgrade --exact @electric-sql/prisma-generator',
  [],
  { stdio: ['ignore', 'ignore', 'pipe'], cwd: projectDir, shell: true }
)

let errors: Uint8Array[] = []
proc.stderr.on('data', (data) => {
  errors = errors.concat(data)
})

proc.on('close', async (code) => {
  if (code === 0) {
    // Pull latest electric image from docker hub
    // such that we are sure that it is compatible with the latest client
    spinner.text = 'Pulling latest Electric image'
    shell.exec('docker pull electricsql/electric:latest', { silent: true })
    
    const { stdout } = shell.exec("docker image inspect --format '{{.RepoDigests}}' electricsql/electric:latest", { silent: true })
    const parsedHash = /^\[(.+)\]/.exec(stdout)
    let electricImage = 'electricsql/electric:latest'
    if (parsedHash) {
      electricImage = parsedHash[1]
    }
    else {
      // electric image hash not found
      // ignore it, and just let .envrc point to electricsql/electric:latest
      console.info("Could not find hash of electric image. Using 'electricsql/electric:latest' instead.")
    }

    // write the electric image to use to .envrc file
    await fs.appendFile(envrcFile, `export ELECTRIC_IMAGE=${electricImage}\n`)
  }

  spinner.stop()
  if (code === 0) {
    console.log(`⚡️ Your ElectricSQL app is ready at \`./${projectName}\``)
  }
  else {
    console.error(Buffer.concat(errors).toString())
    console.log(`⚡️ Could not install project dependencies. Nevertheless the template for your app can be found at \`./${projectName}\``)
  }

  console.log(`Navigate to your app folder \`cd ${projectName}\` and follow the instructions in the README.md.`)
})

/*
 * Replaces the first occurence of `find` by `replace` in the file `file`.
 * If `find` is a regular expression that sets the `g` flag, then it replaces all occurences.
 */ 
async function findAndReplaceInFile(find: string | RegExp, replace: string, file: string) {
  const content = await fs.readFile(file, 'utf8')
  const replacedContent = content.replace(find, replace)
  await fs.writeFile(file, replacedContent)
}

/**
 * Checks if the given port is open.
 * If not, it will ask the user if
 * they want to choose another port.
 * @returns The chosen port.
 */
async function checkPort(port: number, process: string, defaultPort: number): Promise<number> {
  const portOccupied = await portUsed.check(port)
  if (!portOccupied) {
    return port
  }

  spinner.stop()

  // Warn the user that the chosen port is occupied
  console.warn(`Port ${port} for ${process} already in use.`)
  // Propose user to change port
  prompt.start()
  const i = (await prompt.get({
    properties: {
      switch: {
        description: `Do you want to chose another port for ${process}? [y/n]`,
        type: 'string',
        pattern: /^[y|n]$/,
        message: "Please reply with 'y' or 'n'",
        default: 'y',
      }
    }
  })) as { switch: 'y' | 'n' }
  
  if (i.switch === 'y') {
    const { port } = (await prompt.get({
      properties: {
        port: {
          description: 'port',
          type: 'number',
          pattern: portRegex,
          message: 'Please choose a port between 0 and 65535',
          default: defaultPort,
        }
      }
    }))
    return checkPort(port, process, defaultPort)
  }
  else {
    return port
  }
}

function parsePort(port: string): number {
  if (!portRegex.test(port)) {
    error(`Invalid port '${port}. Port should be between 0 and 65535.'`)
  }
  return Number.parseInt(port)
}