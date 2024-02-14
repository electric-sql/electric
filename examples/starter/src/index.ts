#!/usr/bin/env node

// Usage: npx create-electric-app@latest my-app

import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'
import ora from 'ora'
import portUsed from 'tcp-port-used'
import prompt from 'prompt'

// Regex to check that a number is between 0 and 65535
const portRegex =
  /^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/
const spinner = ora('Validating arguments').start()

const error = (err: string) => {
  spinner.stop()
  console.error(
    '\x1b[31m',
    err +
      '\nnpx create-electric-app [<app-name>] [--electric-port <port>] [--electric-proxy-port <port>]',
    '\x1b[0m'
  )
  process.exit(1)
}

const defaultElectricPort = 5133
const defaultElectricProxyPort = 65432

let projectName = process.argv[2]
let args = process.argv.slice(3)
let electricPort = defaultElectricPort
let electricProxyPort = defaultElectricProxyPort

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
    case '--electric-proxy-port':
      checkValue()
      electricProxyPort = parsePort(value)
      break
    default:
      error(`Unrecognized option: '${flag}'.`)
  }
}

spinner.text = 'Validating app name'
const appNameRegex = /^[a-z0-9]+[a-z0-9-_]*$/
const invalidAppNameMessage =
  `Invalid app name. ` +
  'App names must contain only lowercase letters, decimal digits, dashes, and underscores, ' +
  'and must begin with a lowercase letter or decimal digit.'

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
        pattern: appNameRegex,
        message: invalidAppNameMessage,
        required: true,
      },
      electricPort: {
        description: 'Port on which to run Electric',
        type: 'number',
        pattern: portRegex,
        message: 'Port should be between 0 and 65535.',
        default: electricPort,
      },
      electricProxyPort: {
        description: "Port on which to run Electric's DB proxy",
        type: 'number',
        pattern: portRegex,
        message: 'Port should be between 0 and 65535.',
        default: electricProxyPort,
      },
    }
  })) as { appName: string, electricPort: number, electricProxyPort: number }

  spinner.start()
  projectName = userInput.appName
  electricPort = userInput.electricPort
  electricProxyPort = userInput.electricProxyPort
}

spinner.text = 'Ensuring the necessary ports are free'

if (!appNameRegex.test(projectName)) {
  error(invalidAppNameMessage)
}

electricPort = await checkPort(electricPort, 'Electric', defaultElectricPort)
electricProxyPort = await checkPort(
  electricProxyPort,
  "Electric's proxy",
  defaultElectricProxyPort
)

spinner.text = 'Creating project structure'
spinner.start()

// Create a project directory with the project name
const currentDir = process.cwd()
const projectDir = path.resolve(currentDir, projectName)
await fs.mkdir(projectDir, { recursive: true })

// Copy the app template to the project's directory
const thisDir = path.dirname(fileURLToPath(import.meta.url))
const templateDir = path.resolve(thisDir, '..', 'template')
await fs.cp(templateDir, projectDir, { recursive: true })
await fs.rename(path.join(projectDir, 'dot_gitignore'), path.join(projectDir, '.gitignore'))

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
projectPackageJson.name = projectName

await fs.writeFile(packageJsonFile, JSON.stringify(projectPackageJson, null, 2))

// Update the project's title in the index.html file
const indexFile = path.join(projectDir, 'index.html')
await findAndReplaceInFile('Web Example - ElectricSQL', projectName, indexFile)

// Create a .env.local file
// Write the ELECTRIC_PORT and ELECTRIC_PROXY_PORT variables if they are different
// from the default values
await fs.writeFile(
  path.join(projectDir, '.env.local'),
  [
    ...(electricPort !== defaultElectricPort
      ? [`ELECTRIC_PORT=${electricPort}`]
      : []),
    ...(electricProxyPort !== defaultElectricProxyPort
      ? [`ELECTRIC_PROXY_PORT=${electricProxyPort}`]
      : []),
  ].join('\n')
)

// Run `npm install` in the project directory to install the dependencies
// Also run `npm upgrade` to replace `electric-sql: latest` by `electric-sql: x.y.z`
// where `x.y.z` corresponds to the latest version.
spinner.text = 'Installing dependencies (may take some time) ...'
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
  spinner.stop()
  if (code === 0) {
    console.log(`⚡️ Your ElectricSQL app is ready at \`./${projectName}\``)
  } else {
    console.error(Buffer.concat(errors).toString())
    console.log(
      `⚡️ Could not install project dependencies. Nevertheless the template for your app can be found at \`./${projectName}\``
    )
  }
  console.log(
    `Navigate to your app folder \`cd ${projectName}\` and follow the instructions in the README.md.`
  )
})

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
 * Checks if the given port is open.
 * If not, it will ask the user if
 * they want to choose another port.
 * @returns The chosen port.
 */
async function checkPort(
  port: number,
  process: string,
  defaultPort: number
): Promise<number> {
  const portOccupied = await portUsed.check(port)
  if (!portOccupied) {
    return port
  }

  spinner.stop()

  // Warn the user that the chosen port is occupied
  console.warn(`Port ${port} for ${process} is already in use.`)
  // Propose user to change port
  prompt.start()

  const { port: newPort } = await prompt.get({
    properties: {
      port: {
        description: 'Hit Enter to keep it or enter a different port number',
        type: 'number',
        pattern: portRegex,
        message: 'Please choose a port between 0 and 65535',
        default: port,
      },
    },
  })

  if (newPort === port) {
    // user chose not to change port
    return newPort
  } else {
    // user changed port, check that it is free
    return checkPort(newPort, process, defaultPort)
  }
}

function parsePort(port: string): number {
  if (!portRegex.test(port)) {
    error(`Invalid port '${port}. Port should be between 0 and 65535.'`)
  }
  return Number.parseInt(port)
}
