import * as z from 'zod'
import path from 'path'
import * as fs from 'fs/promises'
import { Migration, parseMetadata, MetaData, makeMigration } from '../migrators'

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
 * @param configFile Configuration file of an electric application.
 */
export async function buildMigrations(
  migrationsFolder: string,
  configFile: string
) {
  try {
    const configObj = (await import(configFile)).default // dynamically import the configuration file
    const configSchema = z.object({}).passthrough()

    const config = configSchema.parse(configObj)
    const migrations = await loadMigrations(migrationsFolder)
    config['migrations'] = migrations // add the migrations to the config
    // Update the configuration file
    await fs.writeFile(
      configFile,
      `export default ${JSON.stringify(config, null, 2)}`
    )
    await writeJsConfigFile(configFile)
  } catch (e) {
    if (e instanceof z.ZodError)
      throw new Error(
        'The specified configuration file is malformed:\n' + e.message
      )
    else throw e
  }
}

/**
 * Makes a .js version that re-exports the contents of the config .mjs file
 * such that programs can import the config using `import config from `path/to/.electric/@config`
 * with .mjs that is not possible because you would have to provide the full path to the `.mjs` file:
 * `import config from `path/to/.electric/@config/index.mjs`
 *
 * Note: The config file has an `mjs` extension because it provides a default import
 *       but when the CLI wants to import it NodeJS complains that it must configured
 *       to allow modules:
 *         Warning: To load an ES module, set "type": "module" in the package.json or use the .mjs extension.
 */
async function writeJsConfigFile(configFile: string) {
  await fs.writeFile(
    path.format({
      ...path.parse(configFile),
      base: '',
      ext: '.js',
    }),
    `export { default } from './index.mjs'`
  )
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
