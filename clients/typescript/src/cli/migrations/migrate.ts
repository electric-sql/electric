import path from 'path'
import * as fs from 'fs/promises'
import * as fs2 from 'fs'
import http from 'http'
import decompress from 'decompress'
import Database from 'better-sqlite3'
import { buildMigrations, getMigrationNames } from './builder'
import { exec, StdioOptions } from 'child_process'

const appRoot = path.resolve() // path where the user ran `npx electric migrate`

export const defaultOptions = {
  service: process.env.ELECTRIC_URL ?? 'http://localhost:5050',
  out: path.join(appRoot, 'src/generated/client'),
}

export type GeneratorOptions = typeof defaultOptions

/**
 * A `DataSourceDescription` object describes on which line the Prisma schema
 * data source is defined and on which line its `provider` and `url` are defined
 * and what their values are.
 */
type DataSourceDescription = {
  dataSourceLineIdx: number
  provider: {
    lineIdx: number
    value: string
  }
  url: {
    lineIdx: number
    value: string
  }
}

/**
 * This function migrates the application.
 * To this end, it fetches the migrations from Electric,
 * applies them to a fresh SQLite DB,
 * uses Prisma to introspect the DB and update the Prisma schema,
 * runs the generator to generate the updated Electric client,
 * and runs `buildMigrations` from `cli/migrator.ts`
 * to build the triggers and write the migrations and their triggers
 * to the config filee in `.electric/@config/index.mjs`
 *
 * @param prismaSchema Path to the Prisma schema (relative path from the root folder of the app or absolute path).
 * @param migrationsFolder Absolute path to the migrations folder.
 * @param configFolder Absolute path to the configuration folder.
 */
export async function generate(opts: GeneratorOptions) {
  // Create a unique temporary folder in which to save
  // intermediate files without risking collisions
  const tmpFolder = await fs.mkdtemp('.electric_migrations_tmp_')

  try {
    const migrationsPath = path.join(tmpFolder, 'migrations')
    await fs.mkdir(migrationsPath)
    const migrationEndpoint = opts.service + '/api/migrations?dialect=sqlite'

    const migrationsFolder = path.resolve(migrationsPath)
    const outFolder = path.resolve(opts.out)
    const migrationsFile = path.join(outFolder, 'migrations.js')

    // Fetch the migrations from Electric endpoint and write them into `tmpFolder`
    await fetchMigrations(migrationEndpoint, migrationsFolder, tmpFolder)

    const dbFile = path.resolve(path.join(tmpFolder, 'electric.db'))
    const db = new Database(dbFile)

    // Load migrations and apply them on our fresh `db` SQLite DB
    const migrations = await loadMigrations(migrationsFolder)
    await applyMigrations(migrations, db)

    // Close the DB
    db.close()

    // Create a fresh Prisma schema that will be used
    // to introspect the SQLite DB after migrating it
    const prismaSchema = await createPrismaSchema(tmpFolder, opts)

    // Replace the data source in the Prisma schema to be SQLite
    // Remember the original data source such that we can restore it later
    const originalDataSource = await getDataSource(prismaSchema)
    await changeDataSourceToSQLite(prismaSchema, dbFile)

    // Introspect the created DB to update the Prisma schema
    await introspectDB(prismaSchema)

    // Modify the data source back to Postgres
    // because Prisma won't generate createMany/updateMany/... schemas
    // if the data source is a SQLite DB.
    await setDataSource(
      prismaSchema,
      originalDataSource.provider.value,
      originalDataSource.url.value
    )

    // Generate a client from the Prisma schema
    console.log('Generating Electric client...')
    await generateElectricClient(prismaSchema)
    const relativePath = path.relative(appRoot, opts.out)
    console.log(`Successfully generated Electric client at: ./${relativePath}`)

    // Build the migrations
    console.log('Building migrations...')
    await buildMigrations(migrationsFolder, migrationsFile)
    console.log('Successfully built migrations')
  } catch (e: any) {
    console.error('generate command failed: ' + JSON.stringify(e.message))
  } finally {
    // Delete our temporary directory
    await fs.rm(tmpFolder, { recursive: true })
  }
}

/**
 * Creates a fresh Prisma schema in the provided folder.
 * The Prisma schema is initialised with a generator and a datasource.
 */
async function createPrismaSchema(folder: string, { out }: GeneratorOptions) {
  const prismaDir = path.join(folder, 'prisma')
  const prismaSchemaFile = path.join(prismaDir, 'schema.prisma')
  await fs.mkdir(prismaDir)
  const provider = path.join(
    appRoot,
    'node_modules/prisma-generator-electric/dist/bin.js'
  )
  const output = path.resolve(out)
  const schema = `generator client {
  provider = "prisma-client-js"
}

generator electric {
  provider      = "${provider}"
  output        = "${output}"
  relationModel = "false"
}

datasource db {
  provider = "postgresql"
  url      = env("PRISMA_DB_URL")
}`
  await fs.writeFile(prismaSchemaFile, schema)
  return prismaSchemaFile
}

async function loadMigrations(migrationsFolder: string): Promise<string[]> {
  const migrationDirNames = await getMigrationNames(migrationsFolder)
  const migrationFiles = migrationDirNames.map((dirName) =>
    path.join(migrationsFolder, dirName, 'migration.sql')
  )
  const migrations = await Promise.all(
    migrationFiles.map((migration) => fs.readFile(migration, 'utf8'))
  )
  return migrations
}

async function getFileLines(prismaSchema: string): Promise<Array<string>> {
  const contents = await fs.readFile(prismaSchema, 'utf8')
  return contents.split(/\r?\n/)
}

async function getDataSource(
  prismaSchema: string
): Promise<DataSourceDescription> {
  const lines = (await getFileLines(prismaSchema)).map((ln) => ln)
  const dataSourceStartIdx = lines.findIndex((ln) =>
    ln.trim().startsWith('datasource ')
  )
  if (dataSourceStartIdx === -1) {
    throw new Error('Prisma schema does not define a datasource.')
  }

  const linesStartingAtDataSource = lines.slice(dataSourceStartIdx)
  const providerIdx =
    dataSourceStartIdx +
    linesStartingAtDataSource.findIndex((ln) =>
      ln.trim().startsWith('provider ')
    )
  const urlIdx =
    dataSourceStartIdx +
    linesStartingAtDataSource.findIndex((ln) => ln.trim().startsWith('url '))

  const providerLine = lines[providerIdx]
  const urlLine = lines[urlIdx]

  return {
    dataSourceLineIdx: dataSourceStartIdx,
    provider: {
      lineIdx: providerIdx,
      value: providerLine,
    },
    url: {
      lineIdx: urlIdx,
      value: urlLine,
    },
  }
}

async function changeDataSourceToSQLite(prismaSchema: string, dbFile: string) {
  await setDataSource(
    prismaSchema,
    '  provider = "sqlite"',
    `  url = "file:${dbFile}"`
  )
}

/**
 * Changes the data source in the Prisma schema to the provided data source values.
 * @param prismaSchema Path to the schema whose datasource must be modified.
 * @param provider The new provider
 * @param url The new url
 */
async function setDataSource(
  prismaSchema: string,
  provider: string,
  url: string
) {
  const ogDataSource = await getDataSource(prismaSchema)
  const providerLineIdx = ogDataSource.provider.lineIdx
  const urlLineIdx = ogDataSource.url.lineIdx

  const lines = (await getFileLines(prismaSchema)).map((ln) => ln)
  lines[providerLineIdx] = provider
  lines[urlLineIdx] = url

  const data = lines.join('\n')

  // Write the modified schema to the file
  await fs.writeFile(prismaSchema, data)
}

const shellOpts = {
  cwd: appRoot,
  stdio: 'inherit' as StdioOptions,
}

async function introspectDB(prismaSchema: string): Promise<void> {
  await executeShellCommand(
    `npx prisma db pull --schema="${prismaSchema}"`,
    'Introspection script exited with error code: '
  )
}

async function generateElectricClient(prismaSchema: string): Promise<void> {
  await executeShellCommand(
    `npx prisma generate --schema="${prismaSchema}"`,
    'Generator script exited with error code: '
  )
}

async function executeShellCommand(
  command: string,
  errMsg: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = exec(command, shellOpts)
    proc.stdout!.pipe(process.stdout)
    proc.stderr!.pipe(process.stderr)

    proc.on('close', (code) => {
      if (code === 0) {
        // Success
        resolve()
      } else {
        reject(errMsg + code)
      }
    })
  })
}

/**
 * Opens the provided DB (or creates it if it doesn't exist) and applies the given migrations on it.
 * @migrations Migrations to apply
 * @db The DB on which to apply the migrations
 */
async function applyMigrations(migrations: string[], db: Database.Database) {
  migrations.forEach((migration) => db.exec(migration))
}

async function fetchMigrations(
  endpoint: string,
  writeTo: string,
  tmpFolder: string
): Promise<void> {
  const options = new URL(endpoint)
  const zipFile = path.join(tmpFolder, 'migrations.zip')
  await new Promise((resolve, reject) => {
    const migrationsZipFile = fs2.createWriteStream(zipFile)
    const req = http.get(options, (response) => {
      response.pipe(migrationsZipFile)
    })

    migrationsZipFile.on('finish', resolve)
    req.on('error', reject)
  })

  // Unzip the migrations
  await decompress(zipFile, writeTo)
}
