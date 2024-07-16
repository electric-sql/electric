/* eslint-disable no-empty-pattern */
import { v4 as uuidv4 } from 'uuid'
import { Client, QueryResult } from 'pg'
import { inject, test } from 'vitest'
import { makePgClient } from './test_helpers'
import { FetchError } from '../../client'

export type IssueRow = { id: string; title: string }
export type GeneratedIssueRow = { id?: string; title: string }
export type UpdateIssueFn = (row: IssueRow) => Promise<QueryResult<IssueRow>>
export type InsertIssuesFn = (...rows: GeneratedIssueRow[]) => Promise<string[]>

export const testWithDbClient = test.extend<{
  dbClient: Client
  aborter: AbortController
  baseUrl: string
  pgSchema: string
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
})

export const testWithIssuesTable = testWithDbClient.extend<{
  issuesTableSql: string
  issuesTableUrl: string
  issuesTableKey: string
  updateIssue: UpdateIssueFn
  insertIssues: InsertIssuesFn
}>({
  issuesTableSql: async ({ dbClient, task }, use) => {
    const tableName = `"issues for ${task.id}"`
    await dbClient.query(`
    DROP TABLE IF EXISTS ${tableName};
    CREATE TABLE ${tableName} (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL
    );
    ALTER TABLE ${tableName} REPLICA IDENTITY FULL;
    COMMENT ON TABLE ${tableName} IS 'Created for ${task.file.name} - ${task.name}';
  `)
    await use(tableName)
    await dbClient.query(`DROP TABLE ${tableName}`)
  },
  issuesTableUrl: async ({ issuesTableSql, pgSchema, baseUrl }, use) => {
    const urlAppropriateTable = pgSchema + `.` + issuesTableSql.slice(1, -1)
    await use(urlAppropriateTable)

    const resp = await fetch(`${baseUrl}/shape/${urlAppropriateTable}`, {
      method: `DELETE`,
    })

    if (!resp.ok)
      console.error(
        await FetchError.fromResponse(
          resp,
          `DELETE ${baseUrl}/shape/${urlAppropriateTable}`
        )
      )
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
  insertIssues: ({ issuesTableSql, dbClient }, use) =>
    use(async (...rows) => {
      const placeholders = rows.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
      const { rows: rows_1 } = await dbClient.query(
        `INSERT INTO ${issuesTableSql} (id, title) VALUES ${placeholders} RETURNING id`,
        rows.flatMap((x) => [x.id ?? uuidv4(), x.title])
      )
      return rows_1.map((x_1) => x_1.id)
    }),
})
