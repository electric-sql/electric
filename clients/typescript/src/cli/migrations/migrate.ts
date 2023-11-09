import path from 'path'
import * as z from 'zod'
import * as fs from 'fs/promises'
import { createWriteStream } from 'fs'
import http from 'node:http'
import https from 'node:https'
import decompress from 'decompress'
import { buildMigrations, getMigrationNames } from './builder'
import { exec } from 'child_process'
import { dedent } from 'ts-dedent'

const appRoot = path.resolve() // path where the user ran `npx electric migrate`

export const defaultOptions = {
  service: process.env.ELECTRIC_URL ?? 'http://localhost:5133',
  proxy:
    process.env.ELECTRIC_PROXY_URL ??
    'postgresql://prisma:proxy_password@localhost:65432/electric', // use "prisma" user because we will introspect the DB via the proxy
  out: path.join(appRoot, 'src/generated/client'),
  watch: false,
  pollingInterval: 1000, // in ms
}

export type GeneratorOptions = typeof defaultOptions

export async function generate(opts: GeneratorOptions) {
  if (opts.watch) {
    watchMigrations(opts)
  } else {
    await _generate(opts)
  }
}

/**
 * Periodically polls Electric's migration endpoint
 * to check for new migrations. Invokes `_generate`
 * when there are new migrations.
 */
async function watchMigrations(opts: Omit<GeneratorOptions, 'watch'>) {
  const pollingInterval = opts.pollingInterval
  const pollMigrations = async () => {
    // Create a unique temporary folder in which to save
    // intermediate files without risking collisions
    const tmpFolder = await fs.mkdtemp('.electric_migrations_tmp_')

    try {
      // Read migrations.js file to check latest migration version
      const latestMigration = await getLatestMigration(opts)

      let migrationEndpoint = opts.service + '/api/migrations?dialect=sqlite'
      if (latestMigration !== undefined) {
        // Only fetch new migrations
        migrationEndpoint = migrationEndpoint + `&version=${latestMigration}`
      }

      const migrationsPath = path.join(tmpFolder, 'migrations')
      await fs.mkdir(migrationsPath)
      const migrationsFolder = path.resolve(migrationsPath)

      // Fetch new migrations from Electric endpoint and write them into `tmpFolder`
      const gotNewMigrations = await fetchMigrations(
        migrationEndpoint,
        migrationsFolder,
        tmpFolder
      )

      if (gotNewMigrations) {
        const newMigrations = await getMigrationNames(migrationsFolder)
        console.info('Discovered new migrations: ' + newMigrations.join(', '))
        await _generate(opts)
      }
    } catch (e) {
      console.error(JSON.stringify(e))
    } finally {
      // Delete our temporary directory
      await fs.rm(tmpFolder, { recursive: true })
      // We use `setTimeout` instead of `setInterval`
      // because `setInterval` does not wait for the
      // async function to finish. Since fetching and
      // building the migrations may take a few seconds
      // we want to avoid parallel invocations of `pollMigrations`
      // which could happen if the time `pollMigrations`
      // takes is longer than the timeout configured in `setInterval`.
      setTimeout(pollMigrations, pollingInterval)
    }
  }

  pollMigrations()
}

/**
 * Reads the migrations file that is bundled with the app
 * and returns the version of the latest migration.
 * Returns false if the migrations file does not exist.
 */
async function getLatestMigration(
  opts: Omit<GeneratorOptions, 'watch'>
): Promise<string | undefined> {
  const migrationsFile = migrationsFilePath(opts)

  // Read the migrations file contents and parse it
  // need to strip the `export default` before parsing.
  // can't use dynamic import because it needs to be a .mjs file
  // as node won't allow dynamically importing a .js file
  // when using `"type": "module"` in package.json
  let migrations: any = undefined
  let migrationsFileContent = ''
  try {
    migrationsFileContent = await fs.readFile(migrationsFile, 'utf8')
  } catch (e) {
    // Migrations file does not exist
    return undefined
  }

  const migrationsSchema = z
    .object({
      statements: z.string().array(),
      version: z.string(),
    })
    .array()

  try {
    const prefix = 'export default '
    const migrationsStr = migrationsFileContent.substring(prefix.length)
    migrations = JSON.parse(migrationsStr)

    const parsedMigrations = migrationsSchema.parse(migrations)
    if (parsedMigrations.length === 0) return undefined
    else {
      const lastMigration = parsedMigrations[parsedMigrations.length - 1]
      return lastMigration.version
    }
  } catch (e) {
    throw new Error(
      'Could not read migrations because they have an unexpected format.'
    )
  }
}

/**
 * This function migrates the application.
 * To this end, it fetches the migrations from Electric,
 * applies them to a fresh SQLite DB,
 * uses Prisma to introspect the DB and update the Prisma schema,
 * runs the generator to generate the updated Electric client,
 * and runs `buildMigrations` from `cli/migrator.ts`
 * to build the triggers and write the migrations and their triggers
 * to the config file in `.electric/@config/index.mjs`
 *
 * @param prismaSchema Path to the Prisma schema (relative path from the root folder of the app or absolute path).
 * @param migrationsFolder Absolute path to the migrations folder.
 * @param configFolder Absolute path to the configuration folder.
 */
async function _generate(opts: Omit<GeneratorOptions, 'watch'>) {
  // Create a unique temporary folder in which to save
  // intermediate files without risking collisions
  const tmpFolder = await fs.mkdtemp('.electric_migrations_tmp_')

  try {
    const migrationsPath = path.join(tmpFolder, 'migrations')
    await fs.mkdir(migrationsPath)
    const migrationEndpoint = opts.service + '/api/migrations?dialect=sqlite'

    const migrationsFolder = path.resolve(migrationsPath)
    const migrationsFile = migrationsFilePath(opts)

    // Fetch the migrations from Electric endpoint and write them into `tmpFolder`
    await fetchMigrations(migrationEndpoint, migrationsFolder, tmpFolder)

    const prismaSchema = await createPrismaSchema(tmpFolder, opts)

    // Introspect the created DB to update the Prisma schema
    await introspectDB(prismaSchema)

    // Add custom validators (such as uuid) to the Prisma schema
    await addValidators(prismaSchema)

    // Modify snake_case table names to PascalCase
    await capitaliseTableNames(prismaSchema)

    // Generate a client from the Prisma schema
    console.log('Generating Electric client...')
    await generateElectricClient(prismaSchema)
    const relativePath = path.relative(appRoot, opts.out)
    console.log(`Successfully generated Electric client at: ./${relativePath}`)

    // Build the migrations
    console.log('Building migrations...')
    await buildMigrations(migrationsFolder, migrationsFile)
    console.log('Successfully built migrations')
  } catch (e: any) {
    console.error('generate command failed: ' + e)
    process.exit(1)
  } finally {
    // Delete our temporary directory
    await fs.rm(tmpFolder, { recursive: true })
  }
}

/**
 * Creates a fresh Prisma schema in the provided folder.
 * The Prisma schema is initialised with a generator and a datasource.
 */
async function createPrismaSchema(
  folder: string,
  { out, proxy }: Omit<GeneratorOptions, 'watch'>
) {
  const prismaDir = path.join(folder, 'prisma')
  const prismaSchemaFile = path.join(prismaDir, 'schema.prisma')
  await fs.mkdir(prismaDir)
  const provider = path.join(
    appRoot,
    'node_modules/@electric-sql/prisma-generator/dist/bin.js'
  )
  const output = path.resolve(out)
  const schema = dedent`
    generator client {
      provider = "prisma-client-js"
    }

    generator electric {
      provider      = "${provider}"
      output        = "${output}"
      relationModel = "false"
    }

    datasource db {
      provider = "postgresql"
      url      = "${proxy}"
    }`
  await fs.writeFile(prismaSchemaFile, schema)
  return prismaSchemaFile
}

async function getFileLines(prismaSchema: string): Promise<Array<string>> {
  const contents = await fs.readFile(prismaSchema, 'utf8')
  return contents.split(/\r?\n/)
}

/**
 * Transforms the table names in the Prisma schema
 * such that they start with a capital letter.
 * All characters before the first letter are dropped
 * because Prisma requires model names to start with a (capital) letter.
 * @param prismaSchema Path to the Prisma schema file.
 */
async function capitaliseTableNames(prismaSchema: string): Promise<void> {
  const lines = await getFileLines(prismaSchema)
  const casedLines = doCapitaliseTableNames(lines)
  // Write the modified Prisma schema to the file
  await fs.writeFile(prismaSchema, casedLines.join('\n'))
}

/**
 * @param lines Individual lines of the Prisma schema
 * @returns The modified lines.
 */
export function doCapitaliseTableNames(lines: string[]): string[] {
  const replacements: Map<string, string> = new Map() // maps table names to their PascalCased model name
  const modelNameToDbName: Map<string, string> = new Map() // maps the PascalCased model names to their original table name

  // Prisma requires model names to adhere to the regex: [A-Za-z][A-Za-z0-9_]*
  const modelRegex = /^\s*model\s+([A-Za-z][A-Za-z0-9_]*)\s*{/
  const getModelName = (ln: string) => ln.match(modelRegex)?.[1]

  lines.forEach((ln, idx) => {
    const tableName = getModelName(ln)
    if (tableName) {
      // Capitalise the first letter due to a bug with lowercase model names in Prisma's DMMF
      // that leads to inconsistent type names in the generated client
      // which in turn leads to type errors in the generated Electric client.
      const modelName = capitaliseFirstLetter(tableName)

      // Replace the model name on this line
      const newLn = ln.replace(modelRegex, (_, _tableName) => {
        return `model ${modelName} {`
      })
      lines[idx] = newLn

      replacements.set(tableName, modelName)
      modelNameToDbName.set(modelName, tableName)
    }
  })

  // Go over the schema again but now
  // replace references to the old table names
  // by the new model name when we are inside
  // the definition of a model
  let modelName: string | undefined
  let modelHasMapAttribute = false
  // we're inside a model definition if we have a model name
  const insideModel = () => modelName !== undefined
  lines = lines.flatMap((ln) => {
    modelName = getModelName(ln) ?? modelName

    if (insideModel() && ln.trim().startsWith('}')) {
      // we're exiting the model definition
      const tableName = modelNameToDbName.get(modelName!)!
      modelName = undefined
      // if no `@@map` annotation was added by Prisma add one ourselves
      if (!modelHasMapAttribute) {
        return [`  @@map("${tableName}")`, ln]
      }
      modelHasMapAttribute = false
      return ln
    }

    // the regex below matches a line containing @@map("originalTableName")
    const nameMappingRegex = /^\s*@@map\("(.*)"\)\s*$/
    const mapAttribute = ln.match(nameMappingRegex)
    if (insideModel() && mapAttribute !== null) {
      // store the mapping from the model name to the original DB name
      modelHasMapAttribute = true
      const originalTableName = mapAttribute[1]
      modelNameToDbName.set(modelName!, originalTableName)
    }

    if (insideModel()) {
      // the regex below matches the beginning of a string
      // followed by two identifiers separated by a space
      // (first identifier is the column name, second is its type)
      const reg = /^(\s*\w+\s+)(\w+)/
      return ln.replace(reg, (_match, columnName, typeName) => {
        const newTypeName = replacements.get(typeName) ?? typeName
        return columnName + newTypeName
      })
    }

    return ln
  })

  return lines
}

async function introspectDB(prismaSchema: string): Promise<void> {
  await executeShellCommand(
    `npx prisma db pull --schema="${prismaSchema}"`,
    'Introspection script exited with error code: '
  )
}

/**
 * Adds validators to the Prisma schema.
 * @param prismaSchema Path to the Prisma schema
 */
async function addValidators(prismaSchema: string): Promise<void> {
  const lines = await getFileLines(removeComments(prismaSchema))
  const newLines = lines.map(addValidator)
  // Write the modified Prisma schema to the file
  await fs.writeFile(prismaSchema, newLines.join('\n'))
}

/**
 * Adds a validator to the Prisma schema line if needed.
 * @param ln A line from the Prisma schema
 */
function addValidator(ln: string): string {
  const field = parseFields(ln)[0] // try to parse a field (the line could be something else than a field)

  if (field) {
    const intValidator = '@zod.number.int().gte(-2147483648).lte(2147483647)'
    const float8Validator = '@zod.custom.use(z.number().or(z.nan()))'

    // Map attributes to validators
    const attributeValidatorMapping = new Map([
      ['@db.Uuid', '@zod.string.uuid()'],
      ['@db.SmallInt', '@zod.number.int().gte(-32768).lte(32767)'],
      ['@db.Int', intValidator],
      ['@db.DoublePrecision', float8Validator],
    ])
    const attribute = field.attributes
      .map((a) => a.type)
      .find((a) => attributeValidatorMapping.has(a))

    if (attribute) {
      return ln + ' /// ' + attributeValidatorMapping.get(attribute)!
    } else {
      // No attribute validators,
      // check if the field's type requires a validator
      const typeValidatorMapping = new Map([
        ['Int', intValidator],
        ['Int?', intValidator],
        ['Int[]', intValidator],
        ['Float', float8Validator],
        ['Float?', float8Validator],
        ['Float[]', float8Validator],
      ])
      const typeValidator = typeValidatorMapping.get(field.type)

      if (typeValidator) {
        return ln + ' /// ' + typeValidator
      } else {
        return ln
      }
    }
  } else {
    return ln
  }
}

async function generateElectricClient(prismaSchema: string): Promise<void> {
  await executeShellCommand(
    `npx prisma generate --schema="${prismaSchema}"`,
    'Generator script exited with error code: '
  )
}

async function executeShellCommand(
  command: string,
  errMsg: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = exec(command, { cwd: appRoot }, (error, _stdout, _stderr) => {
      if (error) {
        console.error(error)
      }
    })

    proc.on('close', (code) => {
      if (code === 0) {
        // Success
        resolve()
      } else {
        reject(errMsg + code)
      }
    })
  })
}

/**
 * Fetches the migrations from the provided endpoint,
 * unzips them and writes them to the `writeTo` location.
 */
async function fetchMigrations(
  endpoint: string,
  writeTo: string,
  tmpFolder: string
): Promise<boolean> {
  const options = new URL(endpoint)
  const zipFile = path.join(tmpFolder, 'migrations.zip')
  const requestModule =
    options.protocol == 'http:'
      ? http
      : options.protocol == 'https:'
      ? https
      : undefined

  if (requestModule === undefined)
    throw new TypeError(
      `Protocol "${options.protocol}" not supported. Expected "http:" or "https:"`
    )

  const gotNewMigrations = await new Promise<boolean>((resolve, reject) => {
    const req = requestModule.get(options, (response) => {
      if (response.statusCode === 204) {
        // No new migrations
        resolve(false)
      } else {
        const migrationsZipFile = createWriteStream(zipFile)
        response.pipe(migrationsZipFile)
        migrationsZipFile.on('finish', () => resolve(true))
      }
    })

    req.on('error', reject)
  })

  // Unzip the migrations
  if (gotNewMigrations) {
    await decompress(zipFile, writeTo)
  }

  return gotNewMigrations
}

function migrationsFilePath(opts: Omit<GeneratorOptions, 'watch'>) {
  const outFolder = path.resolve(opts.out)
  return path.join(outFolder, 'migrations.ts')
}

function capitaliseFirstLetter(word: string): string {
  return word.charAt(0).toUpperCase() + word.substring(1)
}

// The below is duplicated code from the generator
// TODO: move it to a separate helper package
//       also move the model parsing to the package
//       also move the removing comments function

export type Attribute = {
  type: `@${string}`
  args: Array<string>
}
export type Field = {
  field: string
  type: string
  attributes: Array<Attribute>
}

/**
 * Removes all line comments from a string.
 * A line comment is a comment that starts with *exactly* `//`.
 * It does not remove comments starting with `///`.
 */
function removeComments(str: string): string {
  const commentRegex = /(?<=[^/])\/\/(?=[^/]).*$/g // matches // until end of the line (does not match more than 2 slashes)
  return str.replaceAll(commentRegex, '')
}

/**
 * Takes the body of a model and returns
 * an array of fields defined by the model.
 * @param body Body of a model
 * @returns Fields defined by the model
 */
function parseFields(body: string): Array<Field> {
  // The regex below matches the fields of a model (it assumes there are no comments at the end of the line)
  // It uses named captured groups to capture the field name, its type, and optional attributes
  // the type can be `type` or `type?` or `type[]`
  const fieldRegex =
    /^\s*(?<field>\w+)\s+(?<type>[\w]+(\?|(\[]))?)\s*(?<attributes>((@[\w.]+\s*)|(@[\w.]+\(.*\)+\s*))+)?\s*$/gm
  const fieldMatches = [...body.matchAll(fieldRegex)]
  const fs = fieldMatches.map(
    (match) =>
      match.groups as { field: string; type: string; attributes?: string }
  )

  return fs.map((f) => ({
    ...f,
    attributes: parseAttributes(f.attributes ?? ''),
  }))
}

/**
 * Takes a string of attributes, e.g. `@id @db.Timestamp(2)`,
 * and returns an array of attributes, e.g. `['@id', '@db.Timestamp(2)]`.
 * @param attributes String of attributes
 * @returns Array of attributes.
 */
function parseAttributes(attributes: string): Array<Attribute> {
  // Matches each attribute in a string of attributes
  // e.g. @id @db.Timestamp(2)
  // The optional args capture group matches anything
  // but not @or newline because that would be the start of a new attribute
  const attributeRegex = /(?<type>@[\w.]+)(?<args>\([^@\n\r]+\))?/g
  const matches = [...attributes.matchAll(attributeRegex)]
  return matches.map((m) => {
    const { type, args } = m.groups! as { type: string; args?: string }
    const noParens = args?.substring(1, args.length - 1) // arguments without starting '(' and closing ')'
    const parsedArgs = noParens?.split(',')?.map((arg) => arg.trim()) ?? []
    return {
      type: type as `@${string}`,
      args: parsedArgs,
    }
  })
}
