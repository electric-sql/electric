import test from 'ava'
import fs from 'fs'
import ts from 'typescript'
import { _testing } from '../../../src/cli/migrations/migrate'

const tempDir = `.tmp`

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
  relatedId   Int?
  related     Dummy?    @relation(fields: [relatedId], references: [id])
}

model Dummy {
  id          Int        @id
  timestamp   DateTime?  @db.Timestamp(3)
  datatype    DataTypes[]
}
`

/**
 * Checks if the generated client from the Prisma schema can
 * be compile using TypeScript without emitting any errors.
 * @param {ts.CompilerOptions} options compiler options to use
 * @returns {boolean} whether the generated client compiles successfully
 */
function checkGeneratedClientCompiles(
  clientPath: string,
  options: ts.CompilerOptions = defaultTsCompilerOptions
) {
  const sourceFiles = fs
    .readdirSync(clientPath)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => `${clientPath}/${file}`)
  const program = ts.createProgram({
    rootNames: sourceFiles,
    options,
  })
  // Check if the program compiles successfully
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length === 0) return true

  diagnostics.forEach((diagnostic) => {
    console.error(diagnostic.messageText)
  })
  return false
}

/**
 * Generates the type-safe TS client for the specified Prisma schema,
 * following all steps performed by the CLI generation process.
 * @param inlinePrismaSchema the inline Prisma schema to generate the client for
 * @param token unique token to use for the generated schema and client dirs
 * @returns {Promise<string>} the path to the generated client
 */
const generateClient = async (
  inlinePrismaSchema: string,
  token: string
): Promise<string> => {
  const schemaFilePath = `${tempDir}/_generation_test_schema_${token}.prisma`
  const generatedClientPath = `${tempDir}/_generation_test_client_${token}`
  const migrationsPath = `${generatedClientPath}/migrations.ts`
  fs.writeFileSync(schemaFilePath, inlinePrismaSchema)
  // clean up the generated client if present
  fs.rmSync(generatedClientPath, { recursive: true, force: true })
  await _testing.generateClient(schemaFilePath, generatedClientPath)
  await fs.writeFileSync(migrationsPath, 'export default []')
  return generatedClientPath
}

test.before(() => {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir)
  }
})

test('should generate valid TS client for simple schema', async (t) => {
  const clientPath = await generateClient(simpleSchema, 'simple')
  t.true(checkGeneratedClientCompiles(clientPath))
})

test('should generate valid TS client for relational schema', async (t) => {
  const clientPath = await generateClient(relationalSchema, 'relational')
  t.true(checkGeneratedClientCompiles(clientPath))
})

test('should generate valid TS client for schema with all data types', async (t) => {
  const clientPath = await generateClient(dataTypesSchema, 'datatypes')
  t.true(checkGeneratedClientCompiles(clientPath))
})
