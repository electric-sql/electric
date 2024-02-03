import test from 'ava'
import fs from 'fs'
import {
  doCapitaliseTableNames,
  generate,
} from '../../../src/cli/migrations/migrate'
import { getConfig } from '../../../src/cli/config'

const lowerCasePrismaSchema = `
datasource db {
  provider = "postgresql"
  url      = env("PRISMA_DB_URL")
}

generator electric {
  provider                 = "./node_modules/@electric-sql/prisma-generator/packages/generator/dist/bin.js"
  output                   = "../generated"
  relationModel            = true
  writeNullishInModelTypes = true
}

generator client {
  provider = "prisma-client-js"
  output = "../generated/client"
}

model items {
  value String @id
  nbr   Int?
}

model user {
  id      Int      @id
  name    String?
  posts   post[]
  profile user_profile?
}

model post {
  id        Int @id
  title     String @unique
  contents  String
  nbr       Int?
  authorId  Int
  author    user?  @relation(fields: [authorId], references: [id])
}

model user_profile {
  id     Int    @id
  bio    String
  userId Int    @unique
  user   user?  @relation(fields: [userId], references: [id])
}

model model {
  id Int @id
}
`

const expectedPrismaSchema = `
datasource db {
  provider = "postgresql"
  url      = env("PRISMA_DB_URL")
}

generator electric {
  provider                 = "./node_modules/@electric-sql/prisma-generator/packages/generator/dist/bin.js"
  output                   = "../generated"
  relationModel            = true
  writeNullishInModelTypes = true
}

generator client {
  provider = "prisma-client-js"
  output = "../generated/client"
}

model Items {
  value String @id
  nbr   Int?
  @@map("items")
}

model User {
  id      Int      @id
  name    String?
  posts   Post[]
  profile User_profile?
  @@map("user")
}

model Post {
  id        Int @id
  title     String @unique
  contents  String
  nbr       Int?
  authorId  Int
  author    User?  @relation(fields: [authorId], references: [id])
  @@map("post")
}

model User_profile {
  id     Int    @id
  bio    String
  userId Int    @unique
  user   User?  @relation(fields: [userId], references: [id])
  @@map("user_profile")
}

model Model {
  id Int @id
  @@map("model")
}
`

/**
 * Tries to generate client while pointing to addresses that do not
 * have a sync service or migrations proxy running, which should always fail.
 *
 * Returns `true` if failed so the failure can be asserted
 */
const failedGenerate = async (debug = false): Promise<boolean> => {
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
        SERVICE_HOST: 'does-not-exist', // Use a non-existent host to force failure
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
const findMigrationFolder = async (): Promise<string | null> => {
  const files = await fs.readdirSync('./')
  for (const file of files) {
    if (file.startsWith('.electric_migrations_tmp')) {
      return file
    }
  }
  return null
}

test('migrator correctly capitalises model names', (t) => {
  const newSchema = doCapitaliseTableNames(
    lowerCasePrismaSchema.split(/\r?\n/)
  ).join('\n')
  t.assert(newSchema === expectedPrismaSchema)
})

test.serial(
  'migrator should clean up temporary folders on failure',
  async (t) => {
    // should fail generaton - if not, ensure the generation
    // command is not pointing to a running electric service
    t.assert(await failedGenerate(false))

    // should clean up temporary folders
    t.assert((await findMigrationFolder()) === null)
  }
)

test.serial(
  'migrator should retain temporary folder on failure in debug mode',
  async (t) => {
    // should fail generaton in debug mode - if not, ensure the generation
    // command is not pointing to a running electric service
    t.assert(await failedGenerate(true))

    // should retain temporary migrations folder
    const debugMigrationFolder = await findMigrationFolder()
    t.assert(debugMigrationFolder !== null)

    // clean-up folder after test
    await fs.rmdirSync(debugMigrationFolder as string, { recursive: true })
  }
)
