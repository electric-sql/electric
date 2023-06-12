import * as z from 'zod'
import path from 'path'
import * as fs from 'fs/promises'
import { loadMigrations } from '../migrators'

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
