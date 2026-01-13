#!/usr/bin/env node

import { execSync } from 'child_process'
import { createInterface } from 'readline'
import { provisionElectricResources } from './electric-api.js'
import { setupTemplate } from './template-setup.js'
import { join } from 'path'

interface ParsedArgs {
  appName: string
  sourceId?: string
}

function parseArgs(args: string[]): ParsedArgs {
  let appName: string | undefined
  let sourceId: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--source`) {
      sourceId = args[i + 1]
      if (!sourceId || sourceId.startsWith(`-`)) {
        console.error(`Error: --source requires a source ID value`)
        process.exit(1)
      }
      i++ // Skip the value
    } else if (!args[i].startsWith(`-`)) {
      appName = args[i]
    }
  }

  if (!appName) {
    console.error(`Usage: npx @electric-sql/start <app-name> [--source <source-id>]`)
    console.error(
      `       npx @electric-sql/start .  (configure current directory)`
    )
    process.exit(1)
  }

  return { appName, sourceId }
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

interface NextStepsOptions {
  showInstall?: boolean
  showMigrate?: boolean
  showClaim?: boolean
}

function printNextSteps(appName: string, options: NextStepsOptions = {}) {
  const { showInstall = false, showMigrate = false, showClaim = true } = options

  console.log(`Next steps:`)
  if (appName !== `.`) {
    console.log(`  cd ${appName}`)
  }

  if (showInstall) {
    console.log(`  pnpm install`)
  }

  if (showMigrate) {
    console.log(`  pnpm migrate`)
  }

  console.log(`  pnpm dev`)
  console.log(``)
  console.log(`Commands:`)
  console.log(`  pnpm psql             # Connect to database`)
  if (showClaim) {
    console.log(`  pnpm claim            # Claim cloud resources`)
  }
  console.log(`  pnpm deploy:netlify   # Deploy to Netlify`)
  console.log(``)
  console.log(`Tutorial: https://electric-sql.com/docs`)
}

async function main() {
  const args = process.argv.slice(2)
  const { appName, sourceId } = parseArgs(args)

  // Validate app name (skip validation for "." which means current directory)
  if (appName !== `.` && !/^[a-zA-Z0-9-_]+$/.test(appName)) {
    console.error(
      `App name must contain only letters, numbers, hyphens, and underscores`
    )

    process.exit(1)
  }

  if (appName === `.`) {
    console.log(`Configuring current directory...`)
  } else {
    console.log(`Creating app: ${appName}`)
  }

  try {
    let credentials: {
      source_id: string
      secret: string
      DATABASE_URL: string
      claimId?: string
    }
    let userProvidedCredentials = false

    if (sourceId) {
      // User provided source ID, prompt for secret and DATABASE_URL
      const secret = await prompt(`Enter secret for source ${sourceId}: `)
      if (!secret.trim()) {
        console.error(`Error: Secret cannot be empty`)
        process.exit(1)
      }

      const databaseUrl = await prompt(`Enter DATABASE_URL: `)
      if (!databaseUrl.trim()) {
        console.error(`Error: DATABASE_URL cannot be empty`)
        process.exit(1)
      }

      credentials = {
        source_id: sourceId,
        secret: secret.trim(),
        DATABASE_URL: databaseUrl.trim(),
      }
      userProvidedCredentials = true
      console.log(`Using provided credentials...`)
    } else {
      credentials = await provisionElectricResources()
    }

    // Step 2: Setup TanStack Start template
    console.log(`Setting up template...`)
    await setupTemplate(appName, credentials)

    console.log(`Installing dependencies...`)
    try {
      execSync(`pnpm install`, {
        stdio: `inherit`,
        cwd: appName === `.` ? process.cwd() : join(process.cwd(), appName),
      })
    } catch (_error) {
      console.log(`Failed to install dependencies`)
      printNextSteps(appName, {
        showInstall: true,
        showMigrate: true,
        showClaim: !userProvidedCredentials,
      })
      process.exit(1)
    }

    // Skip migrations if user provided credentials (they may have their own DB setup)
    if (!userProvidedCredentials) {
      console.log(`Running migrations...`)
      try {
        execSync(`pnpm migrate`, {
          stdio: `inherit`,
          cwd: appName === `.` ? process.cwd() : join(process.cwd(), appName),
        })
      } catch (_error) {
        console.log(`Failed to apply migrations`)
        printNextSteps(appName, {
          showMigrate: true,
          showClaim: true,
        })
        process.exit(1)
      }
    }

    // Step 3: Display completion message
    console.log(`Setup complete`)
    printNextSteps(appName, {
      showMigrate: userProvidedCredentials,
      showClaim: !userProvidedCredentials,
    })
  } catch (error) {
    console.error(
      `Setup failed:`,
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

export { main }
