import { v4 as uuidv4 } from 'uuid'
import { Client, QueryResult } from 'pg'
import { inject, test } from 'vitest'
import { makePgClient, waitForTransaction } from './test-helpers'
import { FetchError } from '../../src/error'
import { SHAPE_HANDLE_QUERY_PARAM } from '../../src/constants'
import { ShapeStreamOptions } from 'packages/typescript-client/src'

export type IssueRow = { id: string; title: string; priority?: string }
export type GeneratedIssueRow = { id?: string; title: string }
export type UpdateIssueFn = (row: IssueRow) => Promise<QueryResult<IssueRow>>
export type DeleteIssueFn = (row: IssueRow) => Promise<QueryResult<IssueRow>>
export type InsertIssuesFn = (...rows: GeneratedIssueRow[]) => Promise<string[]>
export type ClearIssuesShapeFn = (handle: string) => Promise<void>
export type ClearShapeFn = (
  table: string,
  options?: { handle?: string }
) => Promise<void>
export type WaitForIssuesFn = (opts: {
  numChangesExpected?: number
  shapeStreamOptions?: Partial<ShapeStreamOptions>
}) => Promise<Pick<ShapeStreamOptions, `offset` | `handle`>>

export const testWithDbClient = test.extend<{
  dbClient: Client
  aborter: AbortController
  baseUrl: string
  pgSchema: string
  clearShape: ClearShapeFn
}>({
  dbClient: async ({}, use) => {
    const searchOption = `-csearch_path=${inject(`testPgSchema`)}`
    const client = makePgClient({ options: searchOption })
    await client.connect()
    await use(client)
    await client.end()
  },
  aborter: async ({}, use) => {
    const controller = new AbortController()
    await use(controller)
    controller.abort(`Test complete`)
  },
  baseUrl: async ({}, use) => use(inject(`baseUrl`)),
  pgSchema: async ({}, use) => use(inject(`testPgSchema`)),
  clearShape: async ({}, use) => {
    await use(
      async (
        table: string,
        options: {
          handle?: string
        } = {}
      ) => {
        const baseUrl = inject(`baseUrl`)
        const url = new URL(`${baseUrl}/v1/shape`)

        // if an handle is provided, don't pass the table
        // as the shape definition might have more params
        if (options.handle) {
          url.searchParams.set(SHAPE_HANDLE_QUERY_PARAM, options.handle)
        } else {
          url.searchParams.set(`table`, table)
        }

        const resp = await fetch(url.toString(), { method: `DELETE` })

        if (!resp.ok) {
          // if we've been passed a shape handle then we should expect this delete call to succeed.
          if (resp.status === 404) {
            // the shape wasn't found, so maybe it wasn't created in the first place
          } else {
            console.error(
              await FetchError.fromResponse(resp, `DELETE ${url.toString()}`)
            )
            throw new Error(
              `Could not delete shape ${table} with ID ${options.handle}`
            )
          }
        }
      }
    )
  },
})

export const testWithIssuesTable = testWithDbClient.extend<{
  issuesTableSql: string
  issuesTableUrl: string
  issuesTableKey: string
  updateIssue: UpdateIssueFn
  deleteIssue: DeleteIssueFn
  insertIssues: InsertIssuesFn
  clearIssuesShape: ClearIssuesShapeFn
  waitForIssues: WaitForIssuesFn
}>({
  issuesTableSql: async ({ dbClient, task }, use) => {
    const tableName = `"issues for ${task.id}_${Math.random().toString(16).replace(`.`, `_`)}"`
    await dbClient.query(`
    DROP TABLE IF EXISTS ${tableName};
    CREATE TABLE ${tableName} (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL,
      priority INTEGER NOT NULL
    );
    COMMENT ON TABLE ${tableName} IS 'Created for ${task.file?.name.replace(/'/g, `\``) ?? `unknown`} - ${task.name.replace(`'`, `\``)}';
  `)
    await use(tableName)
    await dbClient.query(`DROP TABLE ${tableName}`)
  },
  issuesTableUrl: async ({ issuesTableSql, pgSchema, clearShape }, use) => {
    const urlAppropriateTable = pgSchema + `.` + issuesTableSql
    await use(urlAppropriateTable)
    try {
      await clearShape(urlAppropriateTable)
    } catch (_) {
      // ignore - clearShape has its own logging
      // we don't want to interrupt cleanup
    }
  },
  issuesTableKey: ({ issuesTableSql, pgSchema }, use) =>
    use(`"${pgSchema}".${issuesTableSql}`),
  updateIssue: ({ issuesTableSql, dbClient }, use) =>
    use(({ id, title }) =>
      dbClient.query(`UPDATE ${issuesTableSql} SET title = $2 WHERE id = $1`, [
        id,
        title,
      ])
    ),
  deleteIssue: ({ issuesTableSql, dbClient }, use) =>
    use(({ id }) =>
      dbClient.query(`DELETE FROM ${issuesTableSql} WHERE id = $1`, [id])
    ),
  insertIssues: ({ issuesTableSql, dbClient }, use) =>
    use(async (...rows) => {
      const placeholders = rows.map(
        (_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`
      )
      const { rows: rows_1 } = await dbClient.query(
        `INSERT INTO ${issuesTableSql} (id, title, priority) VALUES ${placeholders} RETURNING id`,
        rows.flatMap((x) => [x.id ?? uuidv4(), x.title, 10])
      )
      return rows_1.map((x) => x.id)
    }),

  clearIssuesShape: async ({ clearShape, issuesTableUrl }, use) => {
    use((handle?: string) => clearShape(issuesTableUrl, { handle }))
  },

  waitForIssues: ({ issuesTableUrl, baseUrl, aborter }, use) =>
    use(
      ({
        numChangesExpected,
        shapeStreamOptions,
      }: {
        numChangesExpected?: number
        shapeStreamOptions?: Partial<ShapeStreamOptions>
      }) =>
        waitForTransaction({
          baseUrl,
          table: issuesTableUrl,
          shapeStreamOptions,
          numChangesExpected,
          aborter,
        })
    ),
})

export const testWithMultitypeTable = testWithDbClient.extend<{
  tableSql: string
  tableUrl: string
}>({
  tableSql: async ({ dbClient, task }, use) => {
    const tableName = `"multitype table for ${task.id}_${Math.random().toString(16).replace(`.`, `_`)}"`

    await dbClient.query(`
      DROP TABLE IF EXISTS ${tableName};
      DROP TYPE IF EXISTS mood;
      DROP TYPE IF EXISTS complex;
      DROP DOMAIN IF EXISTS posint;
      CREATE TYPE mood AS ENUM ('sad', 'ok', 'happy');
      CREATE TYPE complex AS (r double precision, i double precision);
      CREATE DOMAIN posint AS integer CHECK (VALUE > 0);
      CREATE TABLE ${tableName} (
        txt VARCHAR,
        i2 INT2 PRIMARY KEY,
        i4 INT4,
        i8 INT8,
        f8 FLOAT8,
        b  BOOLEAN,
        json JSON,
        jsonb JSONB,
        ints INT8[],
        ints2 INT8[][],
        int4s INT4[],
        doubles FLOAT8[],
        bools BOOLEAN[],
        moods mood[],
        moods2 mood[][],
        complexes complex[],
        posints posint[],
        jsons JSONB[],
        txts TEXT[],
        value JSON
      )`)

    await use(tableName)

    // Cleanup
    await dbClient.query(`
      DROP TABLE ${tableName};
      DROP TYPE IF EXISTS mood;
      DROP TYPE IF EXISTS complex;
      DROP DOMAIN IF EXISTS posint;
    `)
  },
  tableUrl: async ({ tableSql, clearShape, pgSchema }, use) => {
    const urlAppropriateTable = pgSchema + `.` + tableSql
    await use(urlAppropriateTable)
    try {
      await clearShape(urlAppropriateTable)
    } catch (_) {
      // ignore - clearShape has its own logging
      // we don't want to interrupt cleanup
    }
  },
})

export type InsertBigintRowFn = (
  ...rows: { id: bigint; label: string }[]
) => Promise<void>

export const testWithBigintTable = testWithDbClient.extend<{
  bigintTableSql: string
  bigintTableUrl: string
  insertBigintRows: InsertBigintRowFn
}>({
  bigintTableSql: async ({ dbClient, task }, use) => {
    const tableName = `"bigint_table_${task.id}_${Math.random().toString(16).replace(`.`, `_`)}"`

    await dbClient.query(`
      DROP TABLE IF EXISTS ${tableName};
      CREATE TABLE ${tableName} (
        id INT8 PRIMARY KEY,
        label TEXT NOT NULL
      )`)

    await use(tableName)

    await dbClient.query(`DROP TABLE ${tableName}`)
  },
  bigintTableUrl: async ({ bigintTableSql, clearShape, pgSchema }, use) => {
    const urlAppropriateTable = pgSchema + `.` + bigintTableSql
    await use(urlAppropriateTable)
    try {
      await clearShape(urlAppropriateTable)
    } catch (_) {
      // ignore
    }
  },
  insertBigintRows: ({ bigintTableSql, dbClient }, use) =>
    use(async (...rows) => {
      const placeholders = rows.map(
        (_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`
      )
      await dbClient.query(
        `INSERT INTO ${bigintTableSql} (id, label) VALUES ${placeholders}`,
        rows.flatMap((x) => [x.id.toString(), x.label])
      )
    }),
})

export const testWithSpecialColumnsTable = testWithDbClient.extend<{
  tableSql: string
  tableUrl: string
}>({
  tableSql: async ({ dbClient, task }, use) => {
    const tableName = `"special_cols_${task.id}_${Math.random().toString(16).replace(`.`, `_`)}"`

    // Create a table with column names containing special characters
    await dbClient.query(`
      DROP TABLE IF EXISTS ${tableName};
      CREATE TABLE ${tableName} (
        id INT PRIMARY KEY,
        "normal" TEXT,
        "has,comma" TEXT,
        "has""quote" TEXT,
        "has space" TEXT
      )`)

    await use(tableName)

    // Cleanup
    await dbClient.query(`DROP TABLE ${tableName}`)
  },
  tableUrl: async ({ tableSql, clearShape, pgSchema }, use) => {
    const urlAppropriateTable = pgSchema + `.` + tableSql
    await use(urlAppropriateTable)
    try {
      await clearShape(urlAppropriateTable)
    } catch (_) {
      // ignore - clearShape has its own logging
      // we don't want to interrupt cleanup
    }
  },
})
