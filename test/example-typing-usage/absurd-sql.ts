import { initElectricSqlJs } from '../../src/drivers/absurd-sql'

// Start the background worker.
const url = new URL('./worker.js', import.meta.url)
const worker = new Worker(url, { type: 'module' })

// Electrify the SQL.js / absurd-sql machinery and then open
// a persistent, named database.
initElectricSqlJs(worker, { locateFile: (file) => `/${file}` })
  .then((SQL) => SQL.openDatabase('example.db', { app: '<YOUR APP SLUG>' }))
  .then((db) => db.exec('SELECT 1'))
  .then((results) => console.log('results: ', results))
