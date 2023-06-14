import * as z from 'zod'
import { SatOpMigrate } from '../_generated/protocol/satellite'
import { base64, getProtocolVersion } from '../util'
import { Migration } from './index'
import { generateTriggersForTable } from '../satellite/process'
import * as fs from 'fs/promises'
import path from 'path'

/*
 * This file defines functions to load migrations
 * that were fetched from Electric's endpoint.
 */

const metaDataSchema = z
  .object({
    format: z.string(),
    ops: z.string().array(),
    protocol_version: z.string(),
    version: z.string(),
  })
  .strict()

const format = 'SatOpMigrate'
type Format = typeof format

const protocolVersion = getProtocolVersion()

interface MetaData {
  format: Format
  ops: SatOpMigrate[]
  protocol_version: typeof protocolVersion
  version: string
}

/**
 * Parses the metadata JSON object that accompanies a migration.
 * The main purpose of this function is to
 * decode the array of base64-encoded operations.
 */
export function parseMetadata(data: object): MetaData {
  try {
    const parsed = metaDataSchema.parse(data)
    if (parsed.format !== format)
      throw new Error('Unsupported migration format: ' + parsed.format)

    if (parsed.protocol_version !== protocolVersion)
      throw new Error(
        'Protocol version mismatch for migration. Expected: ' +
          protocolVersion +
          '. Got: ' +
          parsed.protocol_version
      )

    // Now decode the `SatOpMigrate` operations inside the `ops` array
    const decoded: MetaData = {
      format: parsed.format as Format,
      ops: parsed.ops.map(decode),
      protocol_version: parsed.protocol_version as typeof protocolVersion,
      version: parsed.version,
    }

    return decoded
  } catch (e: unknown) {
    if (e instanceof z.ZodError) {
      throw new Error('Failed to parse migration data, due to:\n' + e.message)
    } else {
      throw e
    }
  }
}

/**
 * Takes a migration's meta data and returns a migration.
 * The returned migration contains all DDL statements
 * as well as the necessary triggers.
 * @param migration The migration's meta data.
 * @returns The corresponding migration.
 */
export function makeMigration(migration: MetaData): Migration {
  const statements = migration.ops
    .map((op) => op.stmts.map((stmt) => stmt.sql))
    .flat()
  const tables = migration.ops
    .map((op) => op.table!)
    // remove duplicate tables
    .filter((tbl, idx, arr) => {
      return arr.findIndex((t) => t?.name === tbl?.name) === idx
    })

  const triggers = tables
    .map(generateTriggersForTable)
    .flat()
    .map((stmt) => stmt.sql)

  return {
    statements: [...statements, ...triggers],
    version: migration.version,
  }
}

/**
 * Decodes a base64-encoded `SatOpMigrate` message.
 * @param data String containing the base64-encoded `SatOpMigrate` message.
 */
function decode(data: string): SatOpMigrate {
  const bytes = base64.toBytes(data)
  const dataOrError = SatOpMigrate.decode(bytes)
  if (dataOrError instanceof Error) throw dataOrError
  return dataOrError
}

/**
 * Loads all migrations that are present in the provided migrations folder.
 * @param migrationsFolder Folder where migrations are stored.
 * @returns An array of migrations.
 */
export async function loadMigrations(
  migrationsFolder: string
): Promise<Migration[]> {
  const contents = await fs.readdir(migrationsFolder, { withFileTypes: true })
  const dirs = contents.filter((dirent) => dirent.isDirectory())
  // the directory names encode the order of the migrations
  // therefore we sort them by name to get them in chronological order
  const dirNames = dirs.map((dir) => dir.name).sort()
  const migrationPaths = dirNames.map((dirName) =>
    path.join(migrationsFolder, dirName, 'metadata.json')
  )
  const migrationMetaDatas = await Promise.all(
    migrationPaths.map(readMetadataFile)
  )
  return migrationMetaDatas.map(makeMigration)
}

/**
 * Loads the migrations from the provided `migrationsFolder`
 * and updates the specified configuration file `configFile` accordingly.
 * @param migrationsFolder Folder containing the migrations.
 * @param configFile Configuration file of an electric application.
 */
export async function writeMigrationsToConfigFile(
  migrationsFolder: string,
  configFile: string
) {
  try {
    const configObj = (await import(path.join('../..', configFile))).default // dynamically import the configuration file
    const configSchema = z
      .object({
        app: z.string(),
        migrations: z
          .object({
            statements: z.string().array(),
            version: z.string(),
          })
          .strict()
          .array()
          .optional(),
      })
      .passthrough()

    const config = configSchema.parse(configObj)
    const migrations = await loadMigrations(migrationsFolder)
    config['migrations'] = migrations // add the migrations to the config
    // Update the configuration file
    await fs.writeFile(
      configFile,
      `export default ${JSON.stringify(config, null, 2)}`
    )
  } catch (e) {
    if (e instanceof z.ZodError)
      throw new Error(
        'The specified configuration file is malformed:\n' + e.message
      )
    else throw e
  }
}

/**
 * Reads the specified metadata file.
 * @param path Path to the metadata file.
 * @returns A promise that resolves with the metadata.
 */
async function readMetadataFile(path: string): Promise<MetaData> {
  try {
    const data = await fs.readFile(path, 'utf8')
    const jsonData = JSON.parse(data)

    if (
      typeof jsonData === 'object' &&
      !Array.isArray(jsonData) &&
      jsonData !== null
    ) {
      return parseMetadata(jsonData)
    } else {
      throw new Error(
        `Migration file ${path} has wrong format, expected JSON object but found something else.`
      )
    }
  } catch (e) {
    if (e instanceof SyntaxError)
      throw new Error(`Error while parsing migration file ${path}`)
    else throw e
  }
}
