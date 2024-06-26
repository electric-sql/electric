import * as z from 'zod'
import path from 'path'
import * as fs from 'fs/promises'
import {
  Migration,
  parseMetadata,
  MetaData,
  makeMigration,
} from 'electric-sql/migrators'
import { isObject } from 'electric-sql/util'
import { QueryBuilder } from 'electric-sql/migrators/query-builder'
import {
  TableName,
  MinimalDbSchema,
  createDbDescription,
} from 'electric-sql/client'
import { SatOpMigrate_Table } from 'electric-sql/protocol'

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
 *            Do not to import or export this file from a file
 *            that is being imported by Electric applications
 *            as NodeJS may not be present which will cause
 *            the app to crash with a require not defined error.
 */

/**
 * Loads the migrations from the provided `migrationsFolder`,
 * and updates the specified configuration file `configFile` accordingly.
 * @param migrationsFolder Folder containing the migrations.
 * @param migrationsFile File containing the built migrations of an electric application.
 *                       Built migrations contain the DDL statements and the triggers.
 */
export async function buildMigrations(
  migrationsFolder: string,
  migrationsFile: string,
  builder: QueryBuilder
): Promise<MinimalDbSchema> {
  try {
    const { migrations, dbDescription } = await loadMigrations(
      migrationsFolder,
      builder
    )
    // Update the configuration file
    await fs.writeFile(
      migrationsFile,
      `export default ${JSON.stringify(migrations, null, 2)}`
    )
    return dbDescription
  } catch (e) {
    if (e instanceof z.ZodError)
      throw new Error('Could not build migrations:\n' + e.message)
    else throw e
  }
}

/**
 * Reads the provided `migrationsFolder` and returns an array
 * of all the migrations that are present in that folder.
 * Each of those migrations are in their respective folder.
 * @param migrationsFolder
 */
export async function getMigrationNames(
  migrationsFolder: string
): Promise<string[]> {
  const contents = await fs.readdir(migrationsFolder, { withFileTypes: true })
  const dirs = contents.filter((dirent) => dirent.isDirectory())
  // the directory names encode the order of the migrations
  // therefore we sort them by name to get them in chronological order
  return dirs.map((dir) => dir.name).sort()
}

/**
 * Loads all migrations that are present in the provided migrations folder,
 * and builds a database description from them.
 * @param migrationsFolder Folder where migrations are stored.
 * @returns An object containing an array of migrations as well as database schema describing the tables.
 */
export async function loadMigrations(
  migrationsFolder: string,
  builder: QueryBuilder
): Promise<{ migrations: Migration[]; dbDescription: MinimalDbSchema }> {
  const dirNames = await getMigrationNames(migrationsFolder)
  const migrationPaths = dirNames.map((dirName) =>
    path.join(migrationsFolder, dirName, 'metadata.json')
  )
  const migrationMetaDatas = await Promise.all(
    migrationPaths.map(readMetadataFile)
  )
  // Aggregate table information from all migrations
  // and create the database description
  const tables = aggregateTableInfo(migrationMetaDatas)
  const dbDescription = createDbDescription(tables)
  return {
    migrations: migrationMetaDatas.map((data) => makeMigration(data, builder)),
    dbDescription,
  }
}

function aggregateTableInfo(migrations: MetaData[]): Array<SatOpMigrate_Table> {
  const tables = new Map<TableName, SatOpMigrate_Table>()
  migrations.forEach((migration) => {
    migration.ops.forEach((satOpMigrate) => {
      const tbl = satOpMigrate.table
      if (tbl !== undefined) {
        // table information from later migrations
        // overwrite information from earlier migrations
        tables.set(tbl.name, tbl)
      }
    })
  })
  return Array.from(tables.values())
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

    if (isObject(jsonData)) {
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
