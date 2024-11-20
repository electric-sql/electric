/* eslint-disable no-empty-pattern */
import { v4 as uuidv4 } from 'uuid'
import { Client, QueryResult } from 'pg'
import { inject, test } from 'vitest'
import { makePgClient } from './test-helpers'
import { FetchError } from '@electric-sql/client'

export type IssueRow = { id: string; title: string }
export type GeneratedIssueRow = { id?: string; title: string }
export type UpdateIssueFn = (row: IssueRow) => Promise<QueryResult<IssueRow>>
export type DeleteIssueFn = (row: IssueRow) => Promise<QueryResult<IssueRow>>
export type InsertIssuesFn = (...rows: GeneratedIssueRow[]) => Promise<string[]>
export type ClearIssuesShapeFn = (handle?: string) => Promise<void>
export type ClearShapeFn = (
  table: string,
  handle?: string
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
    use(async (table: string, handle?: string) => {
      const baseUrl = inject(`baseUrl`)
      const resp = await fetch(
        `${baseUrl}/v1/shape?table=${table}${handle ? `&handle=${handle}` : ``}`,
        {
          method: `DELETE`,
        }
      )
      if (!resp.ok) {
        console.error(
          await FetchError.fromResponse(
            resp,
            `DELETE ${baseUrl}/v1/shape?table=${table}`
          )
        )
        throw new Error(
          `Could not delete shape ${table} with handle ${handle}`
        )
      }
    })
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
      title TEXT NOT NULL
    );
    ALTER TABLE ${tableName} REPLICA IDENTITY FULL;
    COMMENT ON TABLE ${tableName} IS 'Created for ${task.file?.name ?? `unknown`} - ${task.name}';
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
      const placeholders = rows.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
      const { rows: rows_1 } = await dbClient.query(
        `INSERT INTO ${issuesTableSql} (id, title) VALUES ${placeholders} RETURNING id`,
        rows.flatMap((x) => [x.id ?? uuidv4(), x.title])
      )
      return rows_1.map((x_1) => x_1.id)
    }),

  clearIssuesShape: async ({ clearShape, issuesTableUrl }, use) => {
    use((handle?: string) => clearShape(issuesTableUrl, handle))
  },
})
