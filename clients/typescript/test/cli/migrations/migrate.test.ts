import test from 'ava'
import fs from 'fs'
import {
  defaultOptions,
  doCapitaliseTableNames,
  generate,
} from '../../../src/cli/migrations/migrate'

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

test('migrator correctly capitalises model names', (t) => {
  const newSchema = doCapitaliseTableNames(
    lowerCasePrismaSchema.split(/\r?\n/)
  ).join('\n')
  t.assert(newSchema === expectedPrismaSchema)
})

// NOTE(msfstef): running two tests in one as it requires sequential order
test('migrator should always delete temporary folder (except for debug)', async (t) => {
  // tries to generate client, returns `true` if failed
  const failedGenerate = async (debug = false) => {
    // silence error for test
    const origConsoleError = console.error
    console.error = (_) => {
      // no-op
    }
    let migrationFailed = false
    try {
      await generate({
        ...defaultOptions,
        // prevent process.exit call to perform test
        exitOnError: false,
        // if set to true, temporary folder is retained on failure
        debug: debug,
      })
    } catch (e) {
      migrationFailed = true
    }
    console.error = origConsoleError
    return migrationFailed
  }

  const findMigrationFolder = async (): Promise<string | null> => {
    const files = await fs.readdirSync('./')
    for (const file of files) {
      if (file.startsWith('.electric_migrations_tmp')) {
        return file
      }
    }
    return null
  }

  await failedGenerate(false)

  // should fail generaton
  t.assert(await failedGenerate(false))

  // should have cleaned up temporary folders
  t.assert((await findMigrationFolder()) === null)

  // should fail generaton in debug mode
  t.assert(await failedGenerate(true))

  // should have retained migration folder
  const debugMigrationFolder = await findMigrationFolder()
  t.assert(debugMigrationFolder !== null)
  await fs.rmdirSync(debugMigrationFolder as string, { recursive: true })
})
