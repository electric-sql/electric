import test from 'ava'
import fs from 'fs'
import ts from 'typescript'
import { _testing } from '../../../src/cli/migrations/migrate'

const schemaFilePath = `.tmp/_generation_test_schema.prisma`
const generatedClientPath = `.tmp/_generation_test_client`
const migrationsPath = `${generatedClientPath}/migrations.ts`

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

const simpleSchema = `
datasource db {
  provider = "postgresql"
  url      = env("PRISMA_DB_URL")
}

model Items {
  value String @id
  @@map("items")
}
`

/**
 * Checks if the generated client from the Prisma schema can
 * be compile using TypeScript without emitting any errors.
 * @param {ts.CompilerOptions} options compiler options to use
 * @returns {boolean} whether the generated client compiles successfully
 */
function checkGeneratedClientCompiles(
  options: ts.CompilerOptions = defaultTsCompilerOptions
) {
  const sourceFiles = fs
    .readdirSync(generatedClientPath)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => `${generatedClientPath}/${file}`)
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
 */
const generateClient = async (inlinePrismaSchema: string) => {
  fs.writeFileSync(schemaFilePath, inlinePrismaSchema)
  await _testing.generateClient(schemaFilePath, generatedClientPath)
  await fs.writeFileSync(migrationsPath, 'export default []')
}

test.serial.afterEach.always(async () => {
  // clean-up schema file and client after test
  fs.rmSync(schemaFilePath, { force: true })
  fs.rmSync(generatedClientPath, { recursive: true, force: true })
})

test.serial('should generate valid TS client for simple schema', async (t) => {
  await generateClient(simpleSchema)
  t.true(checkGeneratedClientCompiles())
})
