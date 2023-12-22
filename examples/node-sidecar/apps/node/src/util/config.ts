import { readFile } from 'fs/promises'

type Config = {
  ipc: {
    port: number
  }
  databaseFile: string
}

function parseConfig(config: string): Config {
  const obj = JSON.parse(config)
  if (typeof obj?.ipc?.port !== 'number') {
    throw new Error('Invalid config file, "ipc"."port" property must be provided and must be a number')
  }
  if (typeof obj?.databaseFile !== 'string') {
    throw new Error('Invalid config file, "databaseFile" property must be provided and must be a string')
  }
  return {
    ipc: {
      port: obj.ipc.port,
    },
    databaseFile: obj.databaseFile,
  }
}


export async function parseConfigFile(path: string): Promise<Config> {
  const contents = await readFile(path, 'utf8')
  return parseConfig(contents)
}