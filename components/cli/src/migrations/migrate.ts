import { createWriteStream } from 'fs'
import { dedent } from 'ts-dedent'
import * as fs from 'fs/promises'
import * as z from 'zod'
import decompress from 'decompress'
import getPort from 'get-port'
import http from 'node:http'
import https from 'node:https'
import path from 'path'
import { appRoot } from '../util'
import { buildMigrations, getMigrationNames } from './builder'
import { getConfig, type Config } from '../config'
import { start } from '../docker-commands/command-start'
import { stop } from '../docker-commands/command-stop'
import { withConfig } from '../configure/command-with-config'
import {
  pgBuilder,
  sqliteBuilder,
  Dialect,
} from 'electric-sql/migrators/query-builder'
import { MinimalDbSchema } from 'electric-sql/client'
import { serializeDbDescription } from '../util/serialize'

const sqliteMigrationsFileName = 'migrations.ts'
const pgMigrationsFileName = 'pg-migrations.ts'

export const defaultPollingInterval = 1000 // in ms

export interface GeneratorOptions {
  watch?: boolean
  pollingInterval?: number
  withMigrations?: string
  withDal?: boolean
  debug?: boolean
  exitOnError?: boolean
  config: Config
}

export async function generate(options: GeneratorOptions) {
  const opts = {
    exitOnError: true,
    ...options,
  }
  let config = opts.config
  if (opts.watch && opts.withMigrations) {
    console.error(
      'Cannot use --watch and --with-migrations at the same time. Please choose one.'
    )
    process.exit(1)
  }
  try {
    if (opts.withMigrations) {
      // Start new ElectricSQL and PostgreSQL containers
      console.log('Starting ElectricSQL and PostgreSQL containers...')
      // Remove the ELECTRIC_SERVICE and ELECTRIC_PROXY env vars
      delete process.env.ELECTRIC_SERVICE
      delete process.env.ELECTRIC_PROXY
      config = getConfig({
        ...config,
        SERVICE: undefined,
        PROXY: undefined,
        ...(await withMigrationsConfig(config.CONTAINER_NAME)),
      })
      opts.config = config
      await start({
        config,
        withPostgres: true,
        detach: true,
        exitOnDetached: false,
      })
      // Run the provided migrations command
      console.log('Running migrations...')
      const ret = withConfig(opts.withMigrations, opts.config)
      if (ret.status !== 0) {
        console.log(
          'Failed to run migrations, --with-migrations command exited with error'
        )
        process.exit(1)
      }
    }
    console.log('Service URL: ' + opts.config.SERVICE)
    console.log('Proxy URL: ' + stripPasswordFromUrl(opts.config.PROXY))
    // Generate the client
    if (opts.watch) {
      watchMigrations(opts)
    } else {
      await _generate(opts)
    }
  } finally {
    if (opts.withMigrations) {
      // Stop and remove the containers
      console.log('Stopping ElectricSQL and PostgreSQL containers...')
      await stop({
        remove: true,
        config,
      })
      console.log('Done')
    }
  }
}

/**
 * Periodically polls Electric's migration endpoint
 * to check for new migrations. Invokes `_generate`
 * when there are new migrations.
 */
async function watchMigrations(opts: GeneratorOptions) {
  const config = opts.config
  const pollingInterval = opts.pollingInterval
  const pollMigrations = async () => {
    // Create a unique temporary folder in which to save
    // intermediate files without risking collisions
    const tmpFolder = await fs.mkdtemp('.electric_migrations_tmp_')

    try {
      // Read migrations.js file to check latest migration version
      const latestMigration = await getLatestMigration(opts)

      let migrationEndpoint = config.SERVICE + '/api/migrations?dialect=sqlite'
      if (latestMigration !== undefined) {
        // Only fetch new migrations
        migrationEndpoint = migrationEndpoint + `&version=${latestMigration}`
      }

      const migrationsPath = path.join(tmpFolder, 'migrations')
      await fs.mkdir(migrationsPath)
      const migrationsFolder = path.resolve(migrationsPath)

      // Fetch new migrations from Electric endpoint and write them into `tmpFolder`
      const gotNewMigrations = await fetchMigrations(
        migrationEndpoint,
        migrationsFolder,
        tmpFolder
      )

      if (gotNewMigrations) {
        const newMigrations = await getMigrationNames(migrationsFolder)
        console.info('Discovered new migrations: ' + newMigrations.join(', '))
        await _generate(opts)
      }
    } catch (e) {
      console.error(JSON.stringify(e))
    } finally {
      // Delete our temporary directory
      await fs.rm(tmpFolder, { recursive: true })
      // We use `setTimeout` instead of `setInterval`
      // because `setInterval` does not wait for the
      // async function to finish. Since fetching and
      // building the migrations may take a few seconds
      // we want to avoid parallel invocations of `pollMigrations`
      // which could happen if the time `pollMigrations`
      // takes is longer than the timeout configured in `setInterval`.
      setTimeout(pollMigrations, pollingInterval)
    }
  }

  pollMigrations()
}

/**
 * Reads the migrations file that is bundled with the app
 * and returns the version of the latest migration.
 * Returns false if the migrations file does not exist.
 */
async function getLatestMigration(
  opts: Omit<GeneratorOptions, 'watch'>
): Promise<string | undefined> {
  const migrationsFile = migrationsFilePath(opts, 'SQLite')

  // Read the migrations file contents and parse it
  // need to strip the `export default` before parsing.
  // can't use dynamic import because it needs to be a .mjs file
  // as node won't allow dynamically importing a .js file
  // when using `"type": "module"` in package.json
  let migrations: any = undefined
  let migrationsFileContent = ''
  try {
    migrationsFileContent = await fs.readFile(migrationsFile, 'utf8')
  } catch (e) {
    // Migrations file does not exist
    return undefined
  }

  const migrationsSchema = z
    .object({
      statements: z.string().array(),
      version: z.string(),
    })
    .array()

  try {
    const prefix = 'export default '
    const migrationsStr = migrationsFileContent.substring(prefix.length)
    migrations = JSON.parse(migrationsStr)

    const parsedMigrations = migrationsSchema.parse(migrations)
    if (parsedMigrations.length === 0) return undefined
    else {
      const lastMigration = parsedMigrations[parsedMigrations.length - 1]
      return lastMigration.version
    }
  } catch (e) {
    throw new Error(
      'Could not read migrations because they have an unexpected format.'
    )
  }
}

async function bundleMigrationsFor(
  dialect: Dialect,
  opts: Omit<GeneratorOptions, 'watch'>,
  tmpFolder: string
) {
  const config = opts.config
  const folder = dialect === 'SQLite' ? 'migrations' : 'pg-migrations'
  const migrationsPath = path.join(tmpFolder, folder)
  await fs.mkdir(migrationsPath)
  const dialectArg = dialect === 'SQLite' ? 'sqlite' : 'postgresql'
  const migrationEndpoint =
    config.SERVICE + `/api/migrations?dialect=${dialectArg}`

  const migrationsFolder = path.resolve(migrationsPath)
  const migrationsFile = migrationsFilePath(opts, dialect)

  // Fetch the migrations from Electric endpoint and write them into `tmpFolder`
  await fetchMigrations(migrationEndpoint, migrationsFolder, tmpFolder)

  // Build the migrations
  const builder = dialect === 'SQLite' ? sqliteBuilder : pgBuilder
  return async () => {
    return await buildMigrations(migrationsFolder, migrationsFile, builder)
  }
}

async function buildAndBundleMigrations(
  opts: Omit<GeneratorOptions, 'watch'>,
  tmpFolder: string
) {
  const buildSqliteMigrations = await bundleMigrationsFor(
    'SQLite',
    opts,
    tmpFolder
  )
  const buildPgMigrations = await bundleMigrationsFor(
    'Postgres',
    opts,
    tmpFolder
  )

  console.log('Building migrations...')
  const dbDescription = await buildSqliteMigrations()
  await buildPgMigrations()
  console.log('Successfully built migrations')
  return dbDescription
}

/**
 * This function migrates the application.
 * To this end, it fetches the migrations from Electric,
 * and runs `buildMigrations` from `cli/migrator.ts`
 * to build the triggers and write the migrations and their triggers
 * to the config file in `.electric/@config/index.mjs`.
 * It also generates a minimal DB schema from the migrations,
 * and bundles them into the app.
 *
 * @param prismaSchema Path to the Prisma schema (relative path from the root folder of the app or absolute path).
 * @param migrationsFolder Absolute path to the migrations folder.
 * @param configFolder Absolute path to the configuration folder.
 */
async function _generate(opts: Omit<GeneratorOptions, 'watch'>) {
  const config = opts.config
  // Create a unique temporary folder in which to save
  // intermediate files without risking collisions
  const tmpFolder = await fs.mkdtemp('.electric_migrations_tmp_')
  let generationFailed = false

  try {
    // Create `CLIENT_PATH` if it doesn't exist
    await fs.mkdir(config.CLIENT_PATH, { recursive: true })

    // Build and bundle the SQLite and PG migrations
    // This needs to happen after generating the Electric client
    // otherwise Prisma overwrites the files containing the bundled migrations
    const dbDescription = await buildAndBundleMigrations(opts, tmpFolder)

    // Write the database description to a file
    console.log('Generating database schema...')
    await bundleDbDescription(dbDescription, opts.config.CLIENT_PATH)

    if (
      ['nodenext', 'node16'].includes(
        config.MODULE_RESOLUTION.toLocaleLowerCase()
      )
    ) {
      await rewriteImportsForNodeNext(config.CLIENT_PATH)
    }
  } catch (e: any) {
    generationFailed = true
    console.error('generate command failed: ' + e)
    throw e
  } finally {
    // Delete our temporary directory unless in debug mode
    if (!opts.debug) await fs.rm(tmpFolder, { recursive: true })

    // In case of process exit, make sure to run after folder removal
    if (generationFailed && opts.exitOnError) process.exit(1)
  }
}

async function bundleDbDescription(
  dbDescription: MinimalDbSchema,
  outFolder: string
) {
  const dbDescriptionFile = path.join(outFolder, 'index.ts')
  const serializedDbDescription = serializeDbDescription(dbDescription)
  const dbDescriptionStr = dedent`
    import migrations from './migrations'
    import pgMigrations from './pg-migrations'
    import { type TableSchemas, DbSchema, Relation, ElectricClient } from 'electric-sql/client/model'

    const tableSchemas = ${serializedDbDescription} as TableSchemas

    export const schema = new DbSchema(tableSchemas, migrations, pgMigrations)
    export type Electric = ElectricClient<typeof schema>
    export const JsonNull = { __is_electric_json_null__: true }
  `
  await fs.writeFile(dbDescriptionFile, dbDescriptionStr)
  const relativePath = path.relative(appRoot, dbDescriptionFile)
  console.log(`Successfully generated database schema at: ./${relativePath}`)
}

/**
 * Fetches the migrations from the provided endpoint,
 * unzips them and writes them to the `writeTo` location.
 */
async function fetchMigrations(
  endpoint: string,
  writeTo: string,
  tmpFolder: string
): Promise<boolean> {
  const options = new URL(endpoint)
  const zipFile = path.join(tmpFolder, 'migrations.zip')
  const requestModule =
    options.protocol === 'http:'
      ? http
      : options.protocol === 'https:'
      ? https
      : undefined

  if (requestModule === undefined)
    throw new TypeError(
      `Protocol "${options.protocol}" not supported. Expected "http:" or "https:"`
    )

  const gotNewMigrations = await new Promise<boolean>((resolve, reject) => {
    const req = requestModule.get(options, (response) => {
      if (response.statusCode === 204) {
        // No new migrations
        resolve(false)
      } else if (response.statusCode === 200) {
        const migrationsZipFile = createWriteStream(zipFile)
        response.pipe(migrationsZipFile)
        migrationsZipFile.on('finish', () => resolve(true))
      } else {
        // Other status code, indicating a problem
        reject(
          `Failed to fetch migrations from Electric. Got ${response.statusCode} status code.`
        )
      }
    })

    req.on('error', reject)
  })

  // Unzip the migrations
  if (gotNewMigrations) {
    await decompress(zipFile, writeTo)
  }

  return gotNewMigrations
}

function migrationsFilePath(
  opts: Omit<GeneratorOptions, 'watch'>,
  sqlDialect: Dialect
) {
  const outFolder = path.resolve(opts.config.CLIENT_PATH)
  const migrationsFileName =
    sqlDialect === 'SQLite' ? sqliteMigrationsFileName : pgMigrationsFileName
  return path.join(outFolder, migrationsFileName)
}

async function rewriteImportsForNodeNext(clientDir: string): Promise<void> {
  const file = path.join(clientDir, 'index.ts')
  const content = await fs.readFile(file, 'utf8')
  const newContent = content.replace(
    "from './migrations';",
    "from './migrations.js';"
  )
  await fs.writeFile(file, newContent)
}

async function withMigrationsConfig(containerName: string) {
  return {
    HTTP_PORT: await getPort(),
    PG_PROXY_PORT: (await getPort()).toString(),
    DATABASE_PORT: await getPort(),
    SERVICE_HOST: 'localhost',
    PG_PROXY_HOST: 'localhost',
    DATABASE_REQUIRE_SSL: false,
    // Random container name to avoid collisions
    CONTAINER_NAME: `${containerName}-migrations-${Math.random()
      .toString(36)
      .slice(6)}`,
  }
}

function stripPasswordFromUrl(url: string): string {
  const parsed = new URL(url)
  if (parsed.password) {
    parsed.password = '********'
  }
  return parsed.toString()
}
