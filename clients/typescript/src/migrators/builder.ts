import * as z from 'zod'
import { SatOpMigrate } from '../_generated/protocol/satellite'
import { base64, getProtocolVersion } from '../util'
import { Migration } from './index'
import { generateTriggersForTable } from '../satellite/process'

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

export interface MetaData {
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
    // if the operation did not change any table
    // then ignore it as we don't have to build triggers for it
    .filter((op) => op.table !== undefined)
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
