import createPool, { sql } from '@databases/pg'
import fs from 'fs'
import path from 'path'
import * as url from 'url'
import { getConfig } from 'electric-sql/cli'
import { v4 as uuidv4 } from 'uuid'
import { generateKeyBetween } from 'fractional-indexing'

/*
Call with:

ISSUES_TO_LOAD=100 npm run reset
*/

const dirname = url.fileURLToPath(new URL('.', import.meta.url))
const { DATABASE_URL: ELECTRIC_DATABASE_URL } = getConfig()
const DATABASE_URL = process.env.DATABASE_URL || ELECTRIC_DATABASE_URL
console.log('DATABASE_URL', DATABASE_URL)
const DATA_DIR = process.env.DATA_DIR || path.resolve(dirname, 'data')
const ISSUES_TO_LOAD = process.env.ISSUES_TO_LOAD || 112

console.info(`Connecting to Postgres at ${DATABASE_URL}`)
const db = createPool(DATABASE_URL)

const issues = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'issues.json'), 'utf8')
)

const projects = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'projects.json'), 'utf8')
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

async function upsertProject(db, data) {
  const columns = Object.keys(data)
  const columnsNames = columns.join(', ')
  const values = columns.map((column) => data[column])
  return await db.query(sql`
    INSERT INTO project (${sql(columnsNames)})
    VALUES (${sql.join(values.map(sql.value), ', ')})
    ON CONFLICT DO NOTHING
  `)
}

async function importIssue(db, issue) {
  const { comments, ...rest } = issue
  return await makeInsertQuery(db, 'issue', rest)
}

async function importComment(db, comment) {
  return await makeInsertQuery(db, 'comment', comment)
}

function getRandomProjectId() {
  return projects[Math.floor(Math.random() * projects.length)].id
}

// Create the project if it doesn't exist.
for (const project of projects) {
  upsertProject(db, project)
}

let commentCount = 0
const issueToLoad = Math.min(ISSUES_TO_LOAD, issues.length)
const batchSize = 100
for (let i = 0; i < issueToLoad; i += batchSize) {
  await db.tx(async (db) => {
    db.query(sql`SET CONSTRAINTS ALL DEFERRED;`) // disable FK checks
    for (let j = i; j < i + batchSize && j < issueToLoad; j++) {
      process.stdout.write(`Loading issue ${j + 1} of ${issueToLoad}\r`)
      const issue = issues[j]
      const id = uuidv4()
      await importIssue(db, {
        ...issue,
        id: id,
        project_id: getRandomProjectId(),
      })
      for (const comment of issue.comments) {
        commentCount++
        await importComment(db, {
          ...comment,
          issue_id: id,
        })
      }
    }
  })
}

process.stdout.write('\n')

db.dispose()
console.info(`Loaded ${issueToLoad} issues with ${commentCount} comments.`)
