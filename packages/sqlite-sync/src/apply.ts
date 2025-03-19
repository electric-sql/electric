import { MapColumns } from './types'

import { ChangeMessage } from 'packages/typescript-client/dist'
import { SqliteWrapper } from './wrapper'

export interface ApplyMessageToTableOptions {
  sqlite: SqliteWrapper
  table: string
  schema?: string
  message: ChangeMessage<any>
  mapColumns?: MapColumns
  primaryKey: string[]
  debug: boolean
}

// TODO: make better use of prepared statements
// TODO: maybe add schema and create table with _
export async function applyMessageToTable({
  sqlite,
  table,
  message,
  mapColumns,
  primaryKey,
  debug,
}: ApplyMessageToTableOptions): Promise<void> {
  const data = mapColumns ? doMapColumns(mapColumns, message) : message.value
  if (debug) console.log(`applying message`, message)

  switch (message.headers?.operation) {
    case `insert`: {
      const columns = Object.keys(data)
      const stmt = sqlite.prepare(
        `
              INSERT INTO ${table}
              (${columns.join(`, `)})
              VALUES
              (${columns.map((_v, i) => `$` + (i + 1)).join(`, `)})
          `
      )
      try {
        await stmt.run(...columns.map((column) => data[column]))
      } finally {
        stmt.finalize()
      }
      return
    }

    case `update`: {
      if (debug) console.log(`updating`, data)
      const columns = Object.keys(data).filter(
        // we don't update the primary key, they are used to identify the row
        (column) => !primaryKey.includes(column)
      )
      if (columns.length === 0) return // nothing to update
      const stmt = sqlite.prepare(
        `
                UPDATE ${table}
                SET ${columns
                  .map((column, i) => `${column} = $${i + 1}`)
                  .join(`, `)}
                WHERE ${primaryKey
                  .map((column, i) => `${column} = $${columns.length + i + 1}`)
                  .join(` AND `)}
              `
      )
      try {
        await stmt.run(
          ...columns.map((column) => data[column]),
          ...primaryKey.map((column) => data[column])
        )
      } finally {
        stmt.finalize()
      }
      return
    }

    case `delete`: {
      if (debug) console.log(`deleting`, data)
      const stmt = sqlite.prepare(
        `
                DELETE FROM ${table}
                WHERE ${primaryKey
                  .map((column, i) => `${column} = $${i + 1}`)
                  .join(` AND `)}
              `
      )
      try {
        await stmt.run(...primaryKey.map((column) => data[column]))
      } finally {
        stmt.finalize()
      }
      return
    }
  }
}

function doMapColumns(
  mapColumns: MapColumns,
  message: ChangeMessage<any>
): Record<string, any> {
  if (typeof mapColumns === 'function') {
    return mapColumns(message)
  }
  const mappedColumns: Record<string, any> = {}
  for (const [key, value] of Object.entries(mapColumns)) {
    mappedColumns[key] = message.value[value]
  }
  return mappedColumns
}
