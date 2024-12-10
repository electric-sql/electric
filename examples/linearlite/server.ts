import { Hono } from 'hono'
import { cors } from 'hono/cors'
import postgres from 'postgres'
import {
  ChangeSet,
  changeSetSchema,
  CommentChange,
  IssueChange,
} from './src/utils/changes'
import { serve } from '@hono/node-server'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:password@localhost:54321/linearlite'

// Create postgres connection
const sql = postgres(DATABASE_URL)

const app = new Hono()

// Middleware
app.use('/*', cors())

// Routes
app.get('/', async (c) => {
  const result = await sql`
    SELECT 'ok' as status, version() as postgres_version, now() as server_time
  `
  return c.json(result[0])
})

app.post('/apply-changes', async (c) => {
  const content = await c.req.json()
  let parsedChanges: ChangeSet
  try {
    parsedChanges = changeSetSchema.parse(content)
    // Any additional validation of the changes can be done here!
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Invalid changes' }, 400)
  }
  try {
    await applyChanges(parsedChanges)
  } catch (error) {
    // In a real app you would want to check which changes have failed and save that
    // and return that information to the client.
    console.error(error)
    return c.json({ error: 'Failed to apply changes' }, 500)
  }
  return c.json({ success: true })
})

// Start the server
const port = 3001
console.log(`Server is running on port ${port}`)

serve({
  fetch: app.fetch,
  port,
})

async function applyChanges(changes: ChangeSet) {
  const { issues, comments } = changes
  await sql.begin(async (sql) => {
    for (const issue of issues) {
      await applyTableChange('issue', issue, sql)
    }
    for (const comment of comments) {
      await applyTableChange('comment', comment, sql)
    }
  })
}

async function applyTableChange(
  tableName: 'issue' | 'comment',
  change: IssueChange | CommentChange,
  sql: postgres.TransactionSql
): Promise<void> {
  const {
    id,
    modified_columns: modified_columns_raw,
    new: isNew,
    deleted,
  } = change
  const modified_columns = modified_columns_raw as (keyof typeof change)[]

  if (deleted) {
    await sql`
      DELETE FROM ${sql(tableName)} WHERE id = ${id}
    `
  } else if (isNew) {
    await sql`
      INSERT INTO ${sql(tableName)} ${sql(change, 'id', ...modified_columns)}
    `
  } else {
    await sql`
      UPDATE ${sql(tableName)} 
      SET ${sql(change, ...modified_columns)}
      WHERE id = ${id}
    `
  }
}
