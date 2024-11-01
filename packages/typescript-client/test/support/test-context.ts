/* eslint-disable no-empty-pattern */
import { v4 as uuidv4 } from 'uuid'
import { Client, QueryResult } from 'pg'
import { inject, test } from 'vitest'
import { makePgClient } from './test-helpers'
import { FetchError } from '../../src/error'

export type IssueRow = { id: string; title: string; priority?: string }
export type GeneratedIssueRow = { id?: string; title: string }
export type UpdateIssueFn = (row: IssueRow) => Promise<QueryResult<IssueRow>>
export type DeleteIssueFn = (row: IssueRow) => Promise<QueryResult<IssueRow>>
export type InsertIssuesFn = (...rows: GeneratedIssueRow[]) => Promise<string[]>
export type ClearIssuesShapeFn = (shapeId?: string) => Promise<void>
export type ClearShapeFn = (
  table: string,
  options?: { shapeId?: string; databaseId?: string }
) => Promise<void>

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
          databaseId?: string
          shapeId?: string
        } = {}
      ) => {
        const baseUrl = inject(`baseUrl`)
        const url = new URL(`${baseUrl}/v1/shape/${table}`)

        if (!options.databaseId) {
          options.databaseId = inject(`databaseId`)
        }

        url.searchParams.set(`database_id`, options.databaseId)

        if (options.shapeId) {
          url.searchParams.set(`shape_id`, options.shapeId)
        }

        const resp = await fetch(url.toString(), { method: `DELETE` })
        if (!resp.ok) {
          console.error(
            await FetchError.fromResponse(resp, `DELETE ${url.toString()}`)
          )
          throw new Error(
            `Could not delete shape ${table} with ID ${options.shapeId}`
          )
        }
      }
    )
  },
})

export const testWithDbClients = testWithDbClient.extend<{
  otherDbClient: Client
  otherAborter: AbortController
}>({
  otherDbClient: async ({}, use) => {
    const client = new Client({
      connectionString: inject(`otherDatabaseUrl`),
      options: `-csearch_path=${inject(`testPgSchema`)}`,
    })
    await client.connect()
    await use(client)
    await client.end()
  },
  otherAborter: async ({}, use) => {
    const controller = new AbortController()
    await use(controller)
    controller.abort(`Test complete`)
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
}>({
  issuesTableSql: async ({ dbClient, task }, use) => {
    const tableName = `"issues for ${task.id}_${Math.random().toString(16)}"`
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
    use((shapeId?: string) => clearShape(issuesTableUrl, { shapeId }))
  },
})

export const testWithMultiTenantIssuesTable = testWithDbClients.extend<{
  issuesTableSql: string
  issuesTableUrl: string
  insertIssues: InsertIssuesFn
  insertIssuesToOtherDb: InsertIssuesFn
}>({
  issuesTableSql: async ({ dbClient, otherDbClient, task }, use) => {
    const tableName = `"issues for ${task.id}_${Math.random().toString(16)}"`
    const clients = [dbClient, otherDbClient]
    const queryProms = clients.map((client) =>
      client.query(`
        DROP TABLE IF EXISTS ${tableName};
        CREATE TABLE ${tableName} (
          id UUID PRIMARY KEY,
          title TEXT NOT NULL,
          priority INTEGER NOT NULL
        );
        COMMENT ON TABLE ${tableName} IS 'Created for ${task.file?.name.replace(/'/g, `\``) ?? `unknown`} - ${task.name.replace(`'`, `\``)}';
      `)
    )

    await Promise.all(queryProms)

    await use(tableName)

    const cleanupProms = clients.map((client) =>
      client.query(`DROP TABLE ${tableName}`)
    )
    await Promise.all(cleanupProms)
  },
  issuesTableUrl: async ({ issuesTableSql, pgSchema, clearShape }, use) => {
    const urlAppropriateTable = pgSchema + `.` + issuesTableSql
    await use(urlAppropriateTable)
    // ignore errors - clearShape has its own logging
    // we don't want to interrupt cleanup
    await Promise.allSettled([
      clearShape(urlAppropriateTable),
      clearShape(urlAppropriateTable, {
        databaseId: inject(`otherDatabaseId`),
      }),
    ])
  },
  insertIssues: ({ issuesTableSql, dbClient }, use) =>
    use(async (...rows) => {
      const placeholders = rows.map(
        (_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`
      )
      const { rows: result } = await dbClient.query(
        `INSERT INTO ${issuesTableSql} (id, title, priority) VALUES ${placeholders} RETURNING id`,
        rows.flatMap((x) => [x.id ?? uuidv4(), x.title, 10])
      )
      return result.map((x) => x.id)
    }),
  insertIssuesToOtherDb: ({ issuesTableSql, otherDbClient }, use) =>
    use(async (...rows) => {
      const placeholders = rows.map(
        (_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`
      )
      const { rows: result } = await otherDbClient.query(
        `INSERT INTO ${issuesTableSql} (id, title, priority) VALUES ${placeholders} RETURNING id`,
        rows.flatMap((x) => [x.id ?? uuidv4(), x.title, 10])
      )
      return result.map((x) => x.id)
    }),
})

export const testWithMultitypeTable = testWithDbClient.extend<{
  tableSql: string
  tableUrl: string
}>({
  tableSql: async ({ dbClient, task }, use) => {
    const tableName = `"multitype table for ${task.id}_${Math.random().toString(16)}"`

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
