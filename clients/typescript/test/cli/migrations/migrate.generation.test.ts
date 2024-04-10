import test, { ExecutionContext } from 'ava'
import fs from 'fs'
import ts from 'typescript'
import { generateClient } from '../../../src/cli/migrations/migrate'
import path from 'path'

const tempDir = `.tmp`
const generatedFilePrefix = '_generation_test'

const defaultTsCompilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  useDefineForClassFields: true,
  module: ts.ModuleKind.ESNext,
  skipLibCheck: true,

  /* Bundler mode */
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  resolveJsonModule: true,
  isolatedModules: true,
  noEmit: true,

  /* Linting */
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noFallthroughCasesInSwitch: true,
}

const dbSnippet = `
datasource db {
  provider = "postgresql"
  url      = env("PRISMA_DB_URL")
}
`

const simpleSchema = `
${dbSnippet}
model Items {
  value String @id
}
`

const relationalSchema = `
${dbSnippet}

model Items {
  value String @id
  nbr   Int?
}

model User {
  id      Int      @id
  name    String?
  posts   Post[]
  profile Profile?
}

model Post {
  id        Int    @id
  title     String @unique
  contents  String
  nbr       Int?
  authorId  Int
  author    User?  @relation(fields: [authorId], references: [id])
}

model Profile {
  id     Int    @id
  bio    String
  userId Int    @unique
  user   User?  @relation(fields: [userId], references: [id])
}
`

const dataTypesSchema = `
${dbSnippet}

model DataTypes {
  id          Int       @id
  date        DateTime? @db.Date
  time        DateTime? @db.Time(3)
  timetz      DateTime? @db.Timetz(3)
  timestamp   DateTime? @unique @db.Timestamp(3)
  timestamptz DateTime? @db.Timestamptz(3)
  bool        Boolean?
  uuid        String?   @db.Uuid 
  int2        Int?      @db.SmallInt
  int4        Int?
  int8        BigInt?
  float4      Float?    @db.Real
  float8      Float?    @db.DoublePrecision
  json        Json?
  bytea       Bytes?
  enum        KindOfCategory?
  relatedId   Int?
  related     Dummy?    @relation(fields: [relatedId], references: [id])
}

model Dummy {
  id          Int        @id
  timestamp   DateTime?  @db.Timestamp(3)
  datatype    DataTypes[]
}

enum KindOfCategory {
  FIRST
  SECOND
  RANDOM
}
`

/**
 * Checks if the generated client from the Prisma schema can
 * be compiled using TypeScript without emitting any errors.
 * @param options compiler options to use
 * @returns whether the generated client compiles successfully
 */
function checkGeneratedClientCompiles(
  clientPath: string,
  options: ts.CompilerOptions = defaultTsCompilerOptions
) {
  const sourceFiles = fs
    .readdirSync(clientPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((file) => path.join(clientPath, file.name))
  const program = ts.createProgram({
    rootNames: sourceFiles,
    options,
  })
  // Check if the program compiles successfully
  const diagnostics = ts.getPreEmitDiagnostics(program)
  return diagnostics.length === 0
}

/**
 * Generates the type-safe TS client for the specified Prisma schema,
 * following all steps performed by the CLI generation process.
 * @param inlinePrismaSchema the inline Prisma schema to generate the client for
 * @param token unique token to use for the generated schema and client dirs
 * @returns the path to the generated client
 */
const generateClientFromPrismaSchema = async (
  inlinePrismaSchema: string,
  token: string
): Promise<string> => {
  const schemaFilePath = path.join(
    tempDir,
    `${generatedFilePrefix}_schema_${token}.prisma`
  )
  const generatedClientPath = path.join(
    tempDir,
    `${generatedFilePrefix}_client_${token}`
  )
  const migrationsPath = path.join(generatedClientPath, 'migrations.ts')
  fs.writeFileSync(schemaFilePath, inlinePrismaSchema)
  // clean up the generated client if present
  fs.rmSync(generatedClientPath, { recursive: true, force: true })
  await generateClient(schemaFilePath, generatedClientPath)
  await fs.writeFileSync(migrationsPath, 'export default []')
  return generatedClientPath
}

test.before(() => {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir)
  }
})

// This test runs the prisma generator under the hood, which can
// cause issues when running concurrently, so we run them with serial
const generatorTest = (testName: string, fn: (t: ExecutionContext<unknown>) => void) => {
  return test.serial(testName, fn)
}

test.after.always(() => {
  // avoid deleting whole temp directory as it might be used by
  // other tests as well
  const files = fs.readdirSync(tempDir)
  for (const file of files) {
    if (file.startsWith(generatedFilePrefix)) {
      fs.rmSync(path.join(tempDir, file), { recursive: true, force: true })
    }
  }
})

generatorTest('should generate valid TS client for simple schema', async (t) => {
  const clientPath = await generateClientFromPrismaSchema(
    simpleSchema,
    'simple'
  )
  t.true(checkGeneratedClientCompiles(clientPath))
})

generatorTest(
  'should generate valid TS client for relational schema',
  async (t) => {
    const clientPath = await generateClientFromPrismaSchema(
      relationalSchema,
      'relational'
    )
    t.true(checkGeneratedClientCompiles(clientPath))
  }
)

generatorTest(
  'should generate valid TS client for schema with all data types',
  async (t) => {
    const clientPath = await generateClientFromPrismaSchema(
      dataTypesSchema,
      'datatypes'
    )
    t.true(checkGeneratedClientCompiles(clientPath))
  }
)
