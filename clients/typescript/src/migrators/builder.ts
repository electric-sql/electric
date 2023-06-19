import * as z from 'zod'
import { SatOpMigrate } from '../_generated/protocol/satellite'
import { base64, getProtocolVersion } from '../util'
import { Migration } from './index'
import { generateTriggersForTable } from '../satellite/process'

import * as fs from 'fs/promises'
import path from 'path'

/*
 * This file defines functions to build migrations
 * that were fetched from Electric's endpoint.
 * To this end, we read and write files using NodeJS' `fs` module.
 * However, Electric applications do not necessarily run on NodeJS.
 * Thus, this functionality should only be used in dev mode
 * to build migrations from files using NodeJS.
 * In production, the built migrations are directly imported
 * and thus this file is not used.
 *
 * IMPORTANT: Only use this file for building the migrations.
 *            Do not to import or export this file from a file that is being used at runtime
 *            as NodeJS may not be present which will cause the app to crash.
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
  protocolVersion: typeof protocolVersion
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
      protocolVersion: parsed.protocol_version as typeof protocolVersion,
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
