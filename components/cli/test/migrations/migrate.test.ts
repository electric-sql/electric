import test from 'ava'
import fs from 'fs'
import { generate } from '../../src/migrations/migrate'
import { getConfig } from '../../src/config'

/**
 * Tries to generate client while pointing to addresses that do not
 * have a sync service or migrations proxy running, which should always fail.
 *
 * Returns `true` if failed so the failure can be asserted
 */
const generateMigrations = async ({
  failure = false,
  debug = false,
}): Promise<boolean> => {
  let migrationFailed = false
  const origConsoleError = console.error
  try {
    // silence error for test
    console.error = (_) => {
      // no-op
    }
    await generate({
      // point to invalid ports so that it does not find an electric service
      // or migrations proxy and fails
      config: getConfig({
        SERVICE_HOST: failure ? 'does-not-exist' : undefined, // Use a non-existent host to force failure
      }),
      // prevent process.exit call to perform test
      exitOnError: false,

      // if set to true, temporary folder is retained on failure
      debug: debug,
    })
  } catch (e) {
    migrationFailed = true
  } finally {
    console.error = origConsoleError
  }

  return migrationFailed
}

// finds temporary migraitons folder, if it exists
const findMigrationFolder = (): string | null => {
  const files = fs.readdirSync('./')
  for (const file of files) {
    if (file.startsWith('.electric_migrations_tmp')) {
      return file
    }
  }
  return null
}

test.serial.afterEach(async () => {
  // clean-up migrations folder after test
  let migrationFolder = findMigrationFolder()
  while (migrationFolder !== null) {
    fs.rmdirSync(migrationFolder, { recursive: true })
    migrationFolder = findMigrationFolder()
  }
})

test.serial(
  'migrator should clean up temporary folders on failure',
  async (t) => {
    // should fail generaton - if not, ensure the generation
    // command is not pointing to a running electric service
    t.assert(await generateMigrations({ failure: true, debug: false }))

    // should clean up temporary folders
    t.assert(findMigrationFolder() === null)
  }
)

test.serial(
  'migrator should clean up temporary folders on success',
  async (t) => {
    t.assert(await generateMigrations({ failure: false, debug: false }))

    // should clean up temporary folders
    t.assert(findMigrationFolder() === null)
  }
)

test.serial(
  'migrator should retain temporary folder on failure in debug mode',
  async (t) => {
    // should fail generaton in debug mode - if not, ensure the generation
    // command is not pointing to a running electric service
    t.assert(await generateMigrations({ failure: true, debug: true }))

    // should retain temporary migrations folder
    const debugMigrationFolder = findMigrationFolder()
    t.assert(debugMigrationFolder !== null)
  }
)

test.serial(
  'migrator should retain temporary folder on success in debug mode',
  async (t) => {
    t.assert(await generateMigrations({ failure: false, debug: true }))

    // should retain temporary migrations folder
    const debugMigrationFolder = findMigrationFolder()
    t.assert(debugMigrationFolder !== null)
  }
)
