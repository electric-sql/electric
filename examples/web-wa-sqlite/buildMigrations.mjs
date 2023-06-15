import { buildMigrations } from 'electric-sql/migrators/builder'
import path from 'path'

// `process.argv` is an array containing the command line arguments.
// The first two arguments are `node` and the invoked JS file
// IMPORTANT: we expect an absolute path to the `.electric` directory!
//            relative paths won't work due to the difference between dynamic import and NodeJS's `fs` package
const migrationsFolder = process.argv[2]
const electricDir = process.argv[3]
const configFile = path.join(electricDir, '@config/index.mjs')

if (typeof migrationsFolder === 'undefined')
  throw new Error("Missing path to migrations folder.")

if (typeof electricDir === 'undefined')
  throw new Error("Missing path to .electric folder.")

console.log("Building migrations...")
// no need to await `buildMigrations`
// NodeJS will exit once the promise resolved
buildMigrations(migrationsFolder, configFile).then(_ => {
  console.log("Successfully built migrations")
})
