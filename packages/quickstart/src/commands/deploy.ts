import { execSync } from 'child_process'

export function deployCommand(): void {
  const requiredEnvVars = [
    `ELECTRIC_SOURCE_ID`,
    `ELECTRIC_SECRET`,
    `DATABASE_URL`,
  ]
  const missingVars = requiredEnvVars.filter((varName) => !process.env[varName])

  if (missingVars.length > 0) {
    console.error(
      `Missing required environment variables:`,
      missingVars.join(`, `)
    )
    console.error(`Ensure .env file contains all Electric credentials`)
    process.exit(1)
  }

  console.log(`Starting deployment...`)
  console.log(``)

  try {
    // Set Nitro preset for Netlify
    process.env.NITRO_PRESET = `netlify`

    console.log(`Building application...`)
    execSync(`pnpm build`, {
      stdio: `inherit`,
      env: {
        ...process.env,
        NITRO_PRESET: `netlify`,
      },
    })

    console.log(`Deploying to Netlify...`)

    // Deploy with environment variables
    const deployCommand = [
      `netlify deploy`,
      `--prod`,
      `--dir=dist`,
      `--functions=.netlify/functions-internal`,
    ].join(` `)

    execSync(deployCommand, {
      stdio: `inherit`,
      env: {
        ...process.env,
        // Ensure all Electric credentials are available during deployment
        ELECTRIC_SOURCE_ID: process.env.ELECTRIC_SOURCE_ID,
        ELECTRIC_SECRET: process.env.ELECTRIC_SECRET,
        DATABASE_URL: process.env.DATABASE_URL,
      },
    })

    console.log(``)
    console.log(`Deployment completed`)
    console.log(``)
    console.log(`App is live on Netlify with all environment variables.`)
  } catch (error) {
    console.error(
      `Deployment failed:`,
      error instanceof Error ? error.message : error
    )
    console.error(``)
    console.error(`Common issues:`)
    console.error(
      `- Netlify CLI not installed (run: npm install -g netlify-cli)`
    )
    console.error(`- Not logged in (run: netlify login)`)
    console.error(`- Build errors`)
    console.error(`- Missing environment variables in Netlify`)
    console.error(``)
    console.error(`Required environment variables in Netlify settings:`)
    console.error(`- ELECTRIC_SOURCE_ID`)
    console.error(`- ELECTRIC_SECRET`)
    console.error(`- DATABASE_URL`)
    process.exit(1)
  }
}
