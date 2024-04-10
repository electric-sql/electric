#!/usr/bin/env node

// Usage: npx create-electric-app@latest my-app

import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'
import ora from 'ora'
import portUsed from 'tcp-port-used'
import prompt from 'prompt'
import { getTemplateDirectory } from './templates'
import { findAndReplaceInFile, replacePackageJson } from './file-utils'
import { PORT_REGEX } from './parse'
import { CLIOptions, DefaultCLIOptions, getCLIOptions } from './input'

const defaultOptions: DefaultCLIOptions = {
  templateType: 'react',
  electricPort: 5133,
  electricProxyPort: 65432,
} as const

const spinner = ora('Validating arguments').start()

const error = (err: string) => {
  spinner.stop()
  console.error(
    '\x1b[31m',
    err +
      '\nnpx create-electric-app [<app-name>] [--template <template>] [--electric-port <port>] [--electric-proxy-port <port>]',
    '\x1b[0m'
  )
  process.exit(1)
}

spinner.text = 'Validating app name'
spinner.stop()
let options: CLIOptions = { appName: '', ...defaultOptions }
try {
  options = await getCLIOptions(process.argv, defaultOptions)

  spinner.start()
  spinner.text = 'Ensuring the necessary ports are free'
  options.electricPort = await checkPort(
    options.electricPort,
    'Electric',
    defaultOptions.electricPort
  )
  options.electricProxyPort = await checkPort(
    options.electricProxyPort,
    "Electric's proxy",
    defaultOptions.electricProxyPort
  )

  spinner.text = 'Creating project structure'
  spinner.start()
} catch (err: any) {
  error(err.message)
}

// Create a project directory with the project name
const currentDir = process.cwd()
const projectDir = path.resolve(currentDir, options.appName)
await fs.mkdir(projectDir, { recursive: true })

// Copy the app template to the project's directory
const thisDir = path.dirname(fileURLToPath(import.meta.url))
const templateDir = path.resolve(
  thisDir,
  '..',
  getTemplateDirectory(options.templateType)
)
await fs.cp(templateDir, projectDir, { recursive: true })
await fs.rename(
  path.join(projectDir, 'dot_gitignore'),
  path.join(projectDir, '.gitignore')
)

const packageJsonFile = path.join(projectDir, 'package.json')
await replacePackageJson(packageJsonFile, { projectName: options.appName })

// Update the project's title in the index.html file
const indexFile = path.join(projectDir, 'index.html')
await findAndReplaceInFile(
  'Web Example - ElectricSQL',
  options.appName,
  indexFile
)

// Create a .env.local file
// Write the ELECTRIC_PORT and ELECTRIC_PROXY_PORT variables if they are different
// from the default values
await fs.writeFile(
  path.join(projectDir, '.env.local'),
  [
    ...(options.electricPort !== defaultOptions.electricPort
      ? [`ELECTRIC_PORT=${options.electricPort}`]
      : []),
    ...(options.electricProxyPort !== defaultOptions.electricProxyPort
      ? [`ELECTRIC_PROXY_PORT=${options.electricProxyPort}`]
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
    console.log(`⚡️ Your ElectricSQL app is ready at \`./${options.appName}\``)
  } else {
    console.error(Buffer.concat(errors).toString())
    console.log(
      `⚡️ Could not install project dependencies. Nevertheless the template for your app can be found at \`./${options.appName}\``
    )
  }
  console.log(
    `Navigate to your app folder \`cd ${options.appName}\` and follow the instructions in the README.md.`
  )
})

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
        pattern: PORT_REGEX,
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
