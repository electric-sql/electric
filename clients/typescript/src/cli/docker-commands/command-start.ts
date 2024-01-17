import { Command } from 'commander'
import { dedent, parsePgProxyPort } from '../utils'
import { addOptionGroupToCommand, getConfig, Config } from '../config'
import { dockerCompose } from './docker-utils'

export function makeStartCommand() {
  const command = new Command('start')
  command.description(
    'Start the ElectricSQL sync service, and an optional PostgreSQL'
  )

  addOptionGroupToCommand(command, 'electric')

  command.option(
    '--detach',
    'Run in the background instead of printing logs to the console'
  )

  command.action(async (opts: any) => {
    if (opts.databaseUrl && opts.withPostgres) {
      console.error('You cannot set --database-url when using --with-postgres.')
      process.exit(1)
    }
    const config = getConfig(opts)
    if (!config.WITH_POSTGRES && !config.DATABASE_URL) {
      console.error(
        'You must set --database-url or the ELECTRIC_DATABASE_URL env var when not using --with-postgres.'
      )
      process.exit(1)
    }
    const startOptions = {
      detach: opts.detach,
      withPostgres: !!config.WITH_POSTGRES,
      config: config,
    }
    start(startOptions)
  })

  return command
}

interface StartSettings {
  detach?: boolean
  exitOnDetached?: boolean
  withPostgres?: boolean
  config: Config
}

export function start(options: StartSettings) {
  return new Promise<void>((resolve) => {
    const exitOnDetached = options.exitOnDetached ?? true

    console.log(
      `Starting ElectricSQL sync service${
        options.withPostgres ? ' with PostgreSQL' : ''
      }`
    )

    const env = configToEnv(options.config)
    // PG_PROXY_PORT can have a 'http:' prefix, which we need to remove
    // for port mapping to work.
    env.PG_PROXY_PORT_PARSED = parsePgProxyPort(
      env.PG_PROXY_PORT
    ).port.toString()

    const dockerConfig = {
      ...env,
      ...(options.withPostgres
        ? {
            COMPOSE_PROFILES: 'with-postgres',
            COMPOSE_ELECTRIC_SERVICE: 'electric-with-postgres',
            DATABASE_URL: `postgresql://postgres:${
              env?.DATABASE_PASSWORD ?? 'pg_password'
            }@postgres:${env?.DATABASE_PORT ?? '5432'}/${
              options.config.DATABASE_NAME
            }`,
            LOGICAL_PUBLISHER_HOST: 'electric',
          }
        : {}),
    }
    console.log('Docker compose config:', dockerConfig)

    const proc = dockerCompose(
      'up',
      [...(options.detach ? ['--detach'] : [])],
      options.config.CONTAINER_NAME,
      dockerConfig
    )

    proc.on('close', async (code) => {
      if (code === 0) {
        if (options.detach) {
          if (options.withPostgres) {
            await waitForPostgres(options.config.CONTAINER_NAME, dockerConfig)
          }
          await waitForElectric(options.config.SERVICE)
        }
        if (exitOnDetached) {
          process.exit(0)
        }
        resolve()
      } else {
        console.error(
          dedent`
            Failed to start the Electric backend. Check the output from 'docker compose' above.
            If the error message mentions a port already being allocated or address being already in use,
            please change the configuration to an alternative port via the ELECTRIC_HTTP_PORT or
            ELECTRIC_PG_PROXY_PORT environment variables.
          `
        )
        process.exit(code ?? 1)
      }
    })
  })
}

function checkPostgres(containerName: string, env: { [key: string]: string }) {
  return new Promise((resolve, reject) => {
    try {
      const proc = dockerCompose(
        'exec',
        [
          'postgres',
          'pg_isready',
          '-U',
          `${env.DATABASE_USER}`,
          '-p',
          `${env.DATABASE_PORT}`,
        ],
        containerName,
        env
      )
      proc.on('close', (code) => {
        resolve(code === 0)
      })
    } catch (e) {
      reject(e)
    }
  })
}

async function waitForPostgres(containerName: string, env: any) {
  console.log('Waiting for PostgreSQL to be ready...')
  // Await the postgres container to be ready
  const start = Date.now()
  const timeout = 10 * 1000 // 10 seconds
  while (Date.now() - start < timeout) {
    if (await checkPostgres(containerName, env)) {
      console.log('PostgreSQL is ready')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.error(
    dedent`
      Timed out waiting for PostgreSQL to be ready.
      Check the output from 'docker compose' above.
    `
  )
  process.exit(1)
}

async function waitForElectric(serviceUrl: string) {
  console.log('Waiting for Electric to be ready...')
  const statusUrl = `${serviceUrl}/api/status`
  // Status endpoint returns 200 when ready
  const start = Date.now()
  const timeout = 10 * 1000 // 10 seconds
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(statusUrl)
      if (res.ok) {
        console.log('Electric is ready')
        return
      }
    } catch (e) {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.error(
    dedent`
      Timed out waiting for Electric to be ready.
      Check the output from 'docker compose' above.
    `
  )
  process.exit(1)
}

function configToEnv(config: Config) {
  const env: { [key: string]: string } = {}
  for (const [key, val] of Object.entries(config)) {
    if (val === true) {
      env[key] = 'true'
    } else if (val !== undefined) {
      env[key] = val.toString()
    }
  }
  return env
}
