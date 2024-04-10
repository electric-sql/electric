#!/usr/bin/env node

// Usage: npx create-electric-app@latest my-app

import { fileURLToPath } from 'url'
import path from 'path'
import ora from 'ora'
import {
  generateProjectFromTemplate,
  installDependencies,
  modifyTemplateFiles,
} from './file-utils'
import {
  checkPort,
  CLIOptions,
  DefaultCLIOptions,
  getCLIOptions,
} from './input'

const defaultOptions: DefaultCLIOptions = {
  templateType: 'react',
  electricPort: 5133,
  electricProxyPort: 65432,
} as const

// The directory where the templates are located
const templatesParentDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

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


try {
  
  let options: CLIOptions = { appName: '', ...defaultOptions }
  
  spinner.text = 'Validating app name'
  spinner.stop()
  options = await getCLIOptions(process.argv, defaultOptions)

  spinner.start()
  spinner.text = 'Ensuring the necessary ports are free'
  options.electricPort = await checkPort(
    options.electricPort,
    'Electric',
    defaultOptions.electricPort,
    () => spinner.stop()
  )
  spinner.start()
  options.electricProxyPort = await checkPort(
    options.electricProxyPort,
    'Electric',
    defaultOptions.electricProxyPort,
    () => spinner.stop()
  )

  spinner.text = 'Creating project structure'
  spinner.start()

  // Create a project directory from a template
  const currentDir = process.cwd()
  const projectDir = await generateProjectFromTemplate(
    currentDir,
    templatesParentDir,
    options
  )

  // Modify template files to match given options
  await modifyTemplateFiles(projectDir, options)

  // Install project dependencies
  spinner.text = 'Installing dependencies (may take some time) ...'
  spinner.start()
  try {
    await installDependencies(projectDir)
    spinner.stop()
    console.log(`⚡️ Your ElectricSQL app is ready at \`./${options.appName}\``)
  } catch (err) {
    spinner.stop()
    console.log(
      `⚡️ Could not install project dependencies. Nevertheless the template for your app can be found at \`./${options.appName}\``
    )
  }

  console.log(
    `Navigate to your app folder \`cd ${options.appName}\` and follow the instructions in the README.md.`
  )
} catch (err: any) {
  error(err.message)
}
