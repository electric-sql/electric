// TODO: please ignore the quality of this code :)
// just ported from migrate.tsx

const createPool = require('@databases/pg')
const { sql } = require('@databases/pg')
const fs = require('fs')

const pg = {
  username: 'postgres',
  password: 'password',
  dbname: 'electric',
  address: 'localhost',
  port: 5432,
}

const db = createPool(
  `postgresql://${pg.username}:${pg.password}@${pg.address}:${pg.port}/${pg.dbname}`
)

const stmts = []
const data = fs.readFileSync('db/issues.json')
const issuesObjs = JSON.parse(data)

const issues = Object.values(issuesObjs)
// for (let i = 0; i < issues.length; i++) {
for (let i = 0; i < 10000; i++) {
  const issue = issues[i]
  db.query(
    sql`INSERT INTO issue(id, title, priority, status, modified, created, username, kanbanOrder, description) VALUES (\
      ${issue.id},\
      ${issue.title},\
      ${issue.priority},\
      ${issue.status},\
      ${new Date(issue.modified)},\
      ${new Date(issue.created)},\
      ${issue.creator},\
      ${issue.kanbanOrder},\
      ${issue.description})`
  )
    .catch((ex) => {
      console.error(ex)
      process.exitCode = 1
    })
    .finally(() => db.dispose())
}
