import path from 'path'
import * as fs from 'fs/promises'
import { migrationDefaultOptions } from '../migrations'

const configFolder = path.join(migrationDefaultOptions.configFolder, '@config')
const configFileMjs = path.join(configFolder, 'index.mjs')
const configFileJs = path.join(configFolder, 'index.js')

/**
 * Initialises an Electric project by creating the necessary
 * directories and configuration files.
 * Creates a `.electric/@config` directory
 * containing `index.js` and `index.mjs` files.
 * @param appId Application identifier.
 * @param force Will override existing configuration files when set to true.
 */
export async function initialise(appId: string, force = false) {
  // Make the necessary directories if they do not yet exist
  await fs.mkdir(configFolder, { recursive: true })
  // Make the necessary configuration files if they do not yet exist
  const options = {
    flag: force
      ? 'w' // override if it exists
      : 'wx', // fail if it exists
  }

  const indexMjs = {
    app: appId,
    migrations: [],
    // console configuration is needed for authentication
    // TODO: remove console config when new auth lands
    console: {
      host: '127.0.0.1',
      port: 4000,
    },
    replication: {
      host: '127.0.0.1',
      port: 5133,
    },
  }

  const indexMjsData = 'export default ' + JSON.stringify(indexMjs, null, 2)
  const indexJsData = "export { default } from './index.mjs'"

  await tryWritingIgnoreFailure(configFileMjs, indexMjsData, options)
  await tryWritingIgnoreFailure(configFileJs, indexJsData, options)
}

async function tryWritingIgnoreFailure(
  file: string,
  data: string,
  options: any
) {
  try {
    await fs.writeFile(file, data, options)
  } catch (err) {
    console.error(
      `Could not write configuration file ${file}, due to: ` +
        JSON.stringify(err)
    )
  }
}
