import createPool, { sql } from '@databases/pg'
import fs from 'fs'
import path from 'path'
import * as url from 'url'
import { getConfig } from 'electric-sql/cli'
import { v4 as uuidv4 } from 'uuid'

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

const profiles = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'profiles.json'), 'utf8')
)

// always include a test user with id 'testuser'
profiles.unshift({
  id: 'testuser',
  username: 'testuser',
  created: new Date().toISOString(),
})

const projects = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'projects.json'), 'utf8')
)
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

async function upsertProfile(db, data) {
  const columns = Object.keys(data)
  const columnsNames = columns.join(', ')
  const values = columns.map((column) => data[column])
  return await db.query(sql`
    INSERT INTO profile (${sql(columnsNames)})
    VALUES (${sql.join(values.map(sql.value), ', ')})
    ON CONFLICT DO NOTHING
  `)
}

function pickRandomFromArray(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getRandomProjectId() {
  return pickRandomFromArray(projects).id
}

function getRandomUserId() {
  return pickRandomFromArray(profiles).id
}

// Create profiles if they don't exist
await db.tx(async (db) => {
  db.query(sql`SET CONSTRAINTS ALL DEFERRED;`) // disable FK checks
  for (const profile of profiles) {
    await upsertProfile(db, profile)
  }
})

// Create projects if they don't exist
await db.tx(async (db) => {
  db.query(sql`SET CONSTRAINTS ALL DEFERRED;`) // disable FK checks
  for (const project of projects) {
    await upsertProject(db, {
      ...project,
      user_id: getRandomUserId(),
    })
  }
})

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
      const modifiedIssue = {
        ...issue,
        id: id,
        project_id: getRandomProjectId(),
        user_id: getRandomUserId(),
      }
      delete modifiedIssue.username
      await importIssue(db, modifiedIssue)

      for (const comment of issue.comments) {
        commentCount++
        const modifiedComment = {
          ...comment,
          issue_id: id,
          user_id: getRandomUserId(),
        }
        delete modifiedComment.username

        await importComment(db, modifiedComment)
      }
    }
  })
}

process.stdout.write('\n')

db.dispose()
console.info(`Loaded ${issueToLoad} issues with ${commentCount} comments.`)
