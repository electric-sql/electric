#!/usr/bin/env node

import { provisionElectricResources } from './electric-api.js'
import { setupTemplate } from './template-setup.js'

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error(`Usage: npx @electric-sql/start <app-name>`)
    console.error(
      `       npx @electric-sql/start .  (configure current directory)`
    )

    process.exit(1)
  }

  const appName = args[0]

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
    const credentials = await provisionElectricResources()

    // Step 2: Setup TanStack Start template
    console.log(`Setting up template...`)
    await setupTemplate(appName, credentials)

    // Step 3: Display completion message
    console.log(`Setup complete`)
    console.log(``)
    console.log(`Next steps:`)
    if (appName !== `.`) {
      console.log(`  cd ${appName}`)
    }
    console.log(`  pnpm install`)
    console.log(`  pnpm migrate`)
    console.log(`  pnpm dev`)
    console.log(``)
    console.log(`Commands:`)
    console.log(`  pnpm psql             # Connect to database`)
    console.log(`  pnpm claim            # Claim cloud resources`)
    console.log(`  pnpm deploy:netlify   # Deploy to Netlify`)
    console.log(``)
    console.log(`Tutorial: https://electric-sql.com/docs`)
  } catch (error) {
    console.error(
      `Setup failed:`,
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Unexpected error:`, error)
    process.exit(1)
  })
}

export { main }
