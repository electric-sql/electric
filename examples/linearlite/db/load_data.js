import createPool, { sql } from '@databases/pg'
import fs from 'fs'
import path from 'path'
import * as url from 'url'
import { DATABASE_URL } from './util.js'

const dirname = url.fileURLToPath(new URL('.', import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.resolve(dirname, 'data')
const ISSUES_TO_LOAD = process.env.ISSUES_TO_LOAD || 112

console.info(`Connecting to Postgres..`)
const db = createPool(DATABASE_URL)

const issues = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'issues.json'), 'utf8')
)

async function importIssue(db, issue) {
  return await db.query(
    sql`INSERT INTO issue(id, title, description, priority, status, modified, created, kanbanorder, username) VALUES (\
      ${issue.id},\
      ${issue.title},\
      ${issue.description},\
      ${issue.priority},\
      ${issue.status},\
      ${issue.modified},\
      ${issue.created},\
      ${issue.kanbanorder},\
      ${issue.username})`
  )
}

async function importComment(db, comment) {
  return await db.query(
    sql`INSERT INTO comment(id, body, username, issue_id, created_at) VALUES (\
      ${comment.id},\
      ${comment.body},\
      ${comment.username},\
      ${comment.issue_id},\
      ${comment.created_at})`
  )
}

const issueToLoad = Math.min(ISSUES_TO_LOAD, issues.length)
await db.tx(async (db) => {
  for (let i = 0; i < issueToLoad; i++) {
    process.stdout.write(`Loading issue ${i + 1} of ${issueToLoad}\r`)
    const issue = issues[i]
    await importIssue(db, issue)
    for (const comment of issue.comments) {
      await importComment(db, comment)
    }
  }
})
process.stdout.write('\n')

db.dispose()
console.info('Done.')
