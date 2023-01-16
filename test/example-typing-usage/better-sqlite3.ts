import Database from 'better-sqlite3'

import { electrify } from '../../src/drivers/better-sqlite3'

const config = {
  app: '<YOUR APP SLUG>',
  migrations: [],
}

const original = new Database('example.db')

// Normal code use
const stmt = original.prepare('select foo from bar')
const results: any[] = stmt.all()
const changes: number = stmt.run().changes
console.log(changes, results)
original.transaction((x: number) => {
  original.prepare<{ x: number }>('SELECT 1').get({ x })
})

//Electrified code use
electrify(original, config).then((db) => {
  const stmt = db.prepare('select foo from bar')
  const results = stmt.all()
  const changes: number = stmt.run().changes
  console.log(changes, results)

  db.transaction((x: number) => {
    db.prepare<{ x: number }>('SELECT 1').get({ x })
  })
})
