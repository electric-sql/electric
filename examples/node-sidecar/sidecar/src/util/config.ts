import * as z from 'zod'
import { readFile } from 'fs/promises'
import { authToken } from './auth.js'

/*
  Config structure:
  {
    "service": "http://hostname",
    "databaseFile": "./database.db",
    "auth": {
      "token": "TOKEN....."
    },
    "sync": [projects, issues, users]
  }
 */

type TableName = string
export type Shape = Array<TableName>
const shapeSchema: z.ZodType<Shape> = z.string().array()

type Config = {
  service?: string
  databaseFile: string
  ipc: {
    port: number
  }
  auth?: {
    token: string
  }
  sync: Shape
}
const configSchema: z.ZodType<Config> = z.object({
  service: z.string().optional(),
  databaseFile: z.string(),
  ipc: z.object({
    port: z.number(),
  }),
  auth: z.object({
    token: z.string(),
  }).optional(),
  sync: shapeSchema,
})

function parseConfig(config: string): Config {
  try {
    const obj = JSON.parse(config)
    return configSchema.parse(obj)
  } catch (e: any) {
    console.log(`Invalid config file.`)
    throw e
  }
}

export type HydratedConfig = Required<Config>
export function hydrateConfig(config: Config): HydratedConfig {
  return {
    service: 'http://localhost:5133',
    auth: {
      token: authToken(),
    },
    ...config,
  }
}

export async function parseConfigFile(path: string): Promise<Config> {
  const contents = await readFile(path, 'utf8')
  return parseConfig(contents)
}