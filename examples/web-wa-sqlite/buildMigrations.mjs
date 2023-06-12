import { buildMigrations } from 'electric-sql/migrators'
import path from 'path'
//const { buildMigrations } = import('electric-sql/migrators')
//const path = require('path')

// `process.argv` is an array containing the command line arguments.
// The first two arguments are `node` and the invoked JS file
const migrationsFolder = process.argv[2] ?? path.join('./migrations')
const electricDir = process.argv[3] ?? path.join('./.electric/')
const configFile = path.join(electricDir, '@config/index.mjs')

console.log("Building migrations...")
// no need to await `buildMigrations`
// NodeJS will exit once the promise resolved
buildMigrations(migrationsFolder, configFile).then(_ => {
  console.log("Successfully built migrations")
})

// TODO: we are exporting buildMigrations in this branch..
//       will need to commit the changes to TS client separately
//       and then cherry pick that commit in the other branches
//       or just leave it here and will eventually be merged in :-)
//       OR: remove the changes from here, put them in the other branch
//           and then rebase this one :-)

// TODO: when moving this file: use the 2nd arg of the process
//       which is the path to the file
//       then go out of node_modules and go to migrations folder

// OR: pass path to migrations folder and pass path to @config
//     and use defaults in bash if they are not provided
//     (defaults to ./migrations and .electric/@config/index.js)
