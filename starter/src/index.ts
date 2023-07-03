#!/usr/bin/env node

// Usage: npx create-electric-app my-app

import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'

// The first argument will be the project name
const projectName = process.argv[2]

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

// import package.json and deep copy it
// otherwise we can't edit it because
// the JSON object is not extensible
const projectPackageJson = (await import(path.join(projectDir, 'package.json'), { assert: { type: "json" } })).default

// Update the project's package.json with the new project name
projectPackageJson.name = projectName

await fs.writeFile(
  path.join(projectDir, 'package.json'),
  JSON.stringify(projectPackageJson, null, 2)
)

// Run `pnpm install` in the project directory to install the dependencies
const proc = spawn('pnpm install', [], { stdio: 'inherit', cwd: projectDir, shell: true })

proc.on('close', (code) => {
  if (code === 0) {
    console.log(`Success! Your ElectricSQL app is ready at \`./${projectName}\``)
  }
  else {
    console.log(`Could not install project dependencies. Nevertheless the template for your app can be found at \`./${projectName}\``)
  }
})
