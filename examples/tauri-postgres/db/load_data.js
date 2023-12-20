import createPool, { sql } from '@databases/pg'
import fs from 'fs'
import path from 'path'
import * as url from 'url'
import { DATABASE_URL } from './util.js'

const dirname = url.fileURLToPath(new URL('.', import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.resolve(dirname, 'data')
const ISSUES_TO_LOAD = process.env.ISSUES_TO_LOAD || 2

console.info(`Connecting to Postgres..`)
const db = createPool(DATABASE_URL)

const issues = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'issues.json'), 'utf8')
)

async function makeInsertQuery(db, table, data) {
  const columns = Object.keys(data)
  const columnsNames = columns.join(', ')
  const values = columns.map((column) => data[column])
  return await db.query(sql`
    INSERT INTO ${sql.ident(table)} (${sql(columnsNames)})
    VALUES (${sql.join(values.map(sql.value), ', ')})
  `)
}

async function importIssue(db, issue) {
  const { comments, ...rest } = issue
  return await makeInsertQuery(db, 'issue', rest)
}

async function importComment(db, comment) {
  return await makeInsertQuery(db, 'comment', comment)
}

let commentCount = 0
const issueToLoad = Math.min(ISSUES_TO_LOAD, issues.length)
await db.tx(async (db) => {
  for (let i = 0; i < issueToLoad; i++) {
    process.stdout.write(`Loading issue ${i + 1} of ${issueToLoad}\r`)
    const issue = issues[i]
    await importIssue(db, issue)
    for (const comment of issue.comments) {
      commentCount++
      await importComment(db, comment)
    }
  }
})
process.stdout.write('\n')

db.dispose()
console.info(`Loaded ${issueToLoad} issues with ${commentCount} comments.`)
