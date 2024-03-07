import { createWriteStream } from 'fs'
import { dedent } from 'ts-dedent'
import { exec } from 'child_process'
import * as fs from 'fs/promises'
import * as z from 'zod'
import decompress from 'decompress'
import getPort from 'get-port'
import http from 'node:http'
import https from 'node:https'
import Module from 'node:module'
import path from 'path'
import { buildDatabaseURL, parsePgProxyPort } from '../utils'
import { buildMigrations, getMigrationNames } from './builder'
import { findAndReplaceInFile } from '../util'
import { getConfig, type Config } from '../config'
import { start } from '../docker-commands/command-start'
import { stop } from '../docker-commands/command-stop'
import { withConfig } from '../configure/command-with-config'

// Rather than run `npx prisma` we resolve the path to the prisma binary so that
// we can be sure we are using the same version of Prisma that is a dependency of
// the Electric client.
// `Module.createRequire(import.meta.url)` creates an old-style `require()` function
// that can be used to resolve the path to the prisma cli script using
// `require.resolve()`.
// We use the same method to resolve the path to `@electric-sql/prisma-generator`.
const require = Module.createRequire(import.meta.url)
const prismaPath = require.resolve('prisma')
const generatorPath = path.join(
  path.dirname(require.resolve('@electric-sql/prisma-generator')),
  'bin.js'
)

const appRoot = path.resolve() // path where the user ran `npx electric migrate`

export const defaultPollingInterval = 1000 // in ms

export interface GeneratorOptions {
  watch?: boolean
  pollingInterval?: number
  withMigrations?: string
  debug?: boolean
  exitOnError?: boolean
  config: Config
}

export async function generate(options: GeneratorOptions) {
  const opts = {
    exitOnError: true,
    ...options,
  }
  let config = opts.config
  if (opts.watch && opts.withMigrations) {
    console.error(
      'Cannot use --watch and --with-migrations at the same time. Please choose one.'
    )
    process.exit(1)
  }
  console.log('Generating Electric client...')
  try {
    if (opts.withMigrations) {
      // Start new ElectricSQL and PostgreSQL containers
      console.log('Starting ElectricSQL and PostgreSQL containers...')
      // Remove the ELECTRIC_SERVICE and ELECTRIC_PROXY env vars
      delete process.env.ELECTRIC_SERVICE
      delete process.env.ELECTRIC_PROXY
      config = getConfig({
        ...config,
        SERVICE: undefined,
        PROXY: undefined,
        ...(await withMigrationsConfig(config.CONTAINER_NAME)),
      })
      opts.config = config
      await start({
        config,
        withPostgres: true,
        detach: true,
        exitOnDetached: false,
      })
      // Run the provided migrations command
      console.log('Running migrations...')
      const ret = withConfig(opts.withMigrations, opts.config)
      if (ret.status !== 0) {
        console.log(
          'Failed to run migrations, --with-migrations command exited with error'
        )
        process.exit(1)
      }
    }
    console.log('Service URL: ' + opts.config.SERVICE)
    console.log(
      'Proxy URL: ' +
        stripPasswordFromUrl(buildProxyUrlForIntrospection(opts.config))
    )
    // Generate the client
    if (opts.watch) {
      watchMigrations(opts)
    } else {
      await _generate(opts)
    }
  } finally {
    if (opts.withMigrations) {
      // Stop and remove the containers
      console.log('Stopping ElectricSQL and PostgreSQL containers...')
      await stop({
        remove: true,
        config,
      })
      console.log('Done')
    }
  }
}

/**
 * Periodically polls Electric's migration endpoint
 * to check for new migrations. Invokes `_generate`
 * when there are new migrations.
 */
async function watchMigrations(opts: GeneratorOptions) {
  const config = opts.config
  const pollingInterval = opts.pollingInterval
  const pollMigrations = async () => {
    // Create a unique temporary folder in which to save
    // intermediate files without risking collisions
    const tmpFolder = await fs.mkdtemp('.electric_migrations_tmp_')

    try {
      // Read migrations.js file to check latest migration version
      const latestMigration = await getLatestMigration(opts)

      let migrationEndpoint = config.SERVICE + '/api/migrations?dialect=sqlite'
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
  const config = opts.config
  // Create a unique temporary folder in which to save
  // intermediate files without risking collisions
  const tmpFolder = await fs.mkdtemp('.electric_migrations_tmp_')
  let generationFailed = false

  try {
    const migrationsPath = path.join(tmpFolder, 'migrations')
    await fs.mkdir(migrationsPath)
    const migrationEndpoint = config.SERVICE + '/api/migrations?dialect=sqlite'

    const migrationsFolder = path.resolve(migrationsPath)
    const migrationsFile = migrationsFilePath(opts)

    // Fetch the migrations from Electric endpoint and write them into `tmpFolder`
    await fetchMigrations(migrationEndpoint, migrationsFolder, tmpFolder)

    const prismaSchema = await createIntrospectionSchema(tmpFolder, opts)

    // Introspect the created DB to update the Prisma schema
    await introspectDB(prismaSchema)

    // Add custom validators (such as uuid) to the Prisma schema
    await addValidators(prismaSchema)

    // Modify snake_case table names to PascalCase
    await capitaliseTableNames(prismaSchema)

    // Read the contents of the Prisma schema
    const introspectedSchema = await fs.readFile(prismaSchema, 'utf8')

    // Add a generator for the Electric client to the Prisma schema
    await createElectricClientSchema(introspectedSchema, prismaSchema, opts)

    // Generate the Electric client from the Prisma schema
    await generateElectricClient(prismaSchema)

    // Add a generator for the Prisma client to the Prisma schema
    await createPrismaClientSchema(introspectedSchema, prismaSchema, opts)

    // Generate the Prisma client from the Prisma schema
    await generatePrismaClient(prismaSchema)

    const relativePath = path.relative(appRoot, config.CLIENT_PATH)
    // Modify the type of JSON input values in the generated Prisma client
    // because we deviate from Prisma's typing for JSON values
    await extendJsonType(config.CLIENT_PATH)
    // Delete all files generated for the Prisma client, except the typings
    await keepOnlyPrismaTypings(config.CLIENT_PATH)
    console.log(`Successfully generated Electric client at: ./${relativePath}`)

    // Build the migrations
    console.log('Building migrations...')
    await buildMigrations(migrationsFolder, migrationsFile)
    console.log('Successfully built migrations')

    if (
      ['nodenext', 'node16'].includes(
        config.MODULE_RESOLUTION.toLocaleLowerCase()
      )
    ) {
      await rewriteImportsForNodeNext(config.CLIENT_PATH)
    }
  } catch (e: any) {
    generationFailed = true
    console.error('generate command failed: ' + e)
    throw e
  } finally {
    // Delete our temporary directory unless in debug mode
    if (!opts.debug) await fs.rm(tmpFolder, { recursive: true })

    // In case of process exit, make sure to run after folder removal
    if (generationFailed && opts.exitOnError) process.exit(1)
  }
}

/**
 * Escapes file path for use in strings.
 * On Windows, replaces backslashes with double backslashes for string escaping.
 *
 * @param {string} inputPath - The file path to escape.
 * @return {string} The escaped file path.
 */
function escapePathForString(inputPath: string): string {
  return process.platform === 'win32'
    ? inputPath.replace(/\\/g, '\\\\')
    : inputPath
}

function buildProxyUrlForIntrospection(config: Config) {
  return buildDatabaseURL({
    user: 'prisma', // We use the "prisma" user to put the proxy into introspection mode
    password: config.PG_PROXY_PASSWORD,
    host: config.PG_PROXY_HOST,
    port: parsePgProxyPort(config.PG_PROXY_PORT).port,
    dbName: config.DATABASE_NAME,
  })
}

/**
 * Creates a fresh Prisma schema in the provided folder.
 * The Prisma schema is initialised with a generator and a datasource.
 */
async function createIntrospectionSchema(
  folder: string,
  opts: GeneratorOptions
) {
  const config = opts.config
  const prismaDir = path.join(folder, 'prisma')
  const prismaSchemaFile = path.join(prismaDir, 'schema.prisma')
  await fs.mkdir(prismaDir)
  const proxyUrl = buildProxyUrlForIntrospection(config)
  const schema = dedent`
    datasource db {
      provider = "postgresql"
      url      = "${proxyUrl}"
    }`
  await fs.writeFile(prismaSchemaFile, schema)
  return prismaSchemaFile
}

/**
 * Takes the Prisma schema that results from introspecting the DB
 * and extends it with a generator for the Electric client.
 * @param introspectedSchema The Prisma schema that results from introspecting the DB.
 * @param prismaSchemaFile Path to the Prisma schema file.
 * @returns The path to the Prisma schema file.
 */
async function createElectricClientSchema(
  introspectedSchema: string,
  prismaSchemaFile: string,
  opts: GeneratorOptions
) {
  const config = opts.config
  const output = path.resolve(config.CLIENT_PATH)

  const schema = dedent`
    generator electric {
      provider      = "node ${escapePathForString(generatorPath)}"
      output        = "${escapePathForString(output)}"
      relationModel = "false"
    }
    
    ${introspectedSchema}`

  await fs.writeFile(prismaSchemaFile, schema)
  return prismaSchemaFile
}

/**
 * Takes the Prisma schema that results from introspecting the DB
 * and extends it with a generator for the Prisma client.
 * @param introspectedSchema The Prisma schema that results from introspecting the DB.
 * @param prismaSchemaFile Path to the Prisma schema file.
 * @returns The path to the Prisma schema file.
 */
async function createPrismaClientSchema(
  introspectedSchema: string,
  prismaSchemaFile: string,
  opts: GeneratorOptions
) {
  const config = opts.config
  const output = path.resolve(config.CLIENT_PATH)

  const schema = dedent`
    generator client {
      provider = "prisma-client-js"
      output   = "${escapePathForString(output)}"
    }
    
    ${introspectedSchema}`

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
    `node ${prismaPath} db pull --schema="${prismaSchema}"`,
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
    const floatValidator = '@zod.custom.use(z.number().or(z.nan()))'

    // Map attributes to validators
    const attributeValidatorMapping = new Map([
      ['@db.Uuid', '@zod.string.uuid()'],
      ['@db.SmallInt', '@zod.number.int().gte(-32768).lte(32767)'],
      ['@db.Int', intValidator],
      ['@db.DoublePrecision', floatValidator],
      ['@db.Real', floatValidator],
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
        ['Float', floatValidator],
        ['Float?', floatValidator],
        ['Float[]', floatValidator],
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
    `node ${prismaPath} generate --schema="${prismaSchema}"`,
    'Generator script exited with error code: '
  )
}

async function generatePrismaClient(prismaSchema: string): Promise<void> {
  await executeShellCommand(
    `node ${prismaPath} generate --schema="${prismaSchema}"`,
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
  const outFolder = path.resolve(opts.config.CLIENT_PATH)
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

/*
 * Modifies Prisma's `InputJsonValue` type to include `null`
 */
function extendJsonType(prismaDir: string): Promise<void> {
  const prismaTypings = path.join(prismaDir, 'index.d.ts')
  const inputJsonValueRegex = /^\s*export\s*type\s*InputJsonValue\s*(=)\s*/gm
  const replacement = 'export type InputJsonValue = null | '
  return findAndReplaceInFile(inputJsonValueRegex, replacement, prismaTypings)
}

async function keepOnlyPrismaTypings(prismaDir: string): Promise<void> {
  const contents = await fs.readdir(prismaDir)
  // Delete all files except the generated Electric client and the Prisma typings
  const proms = contents.map(async (fileOrDir) => {
    const filePath = path.join(prismaDir, fileOrDir)
    if (fileOrDir === 'index.d.ts') {
      // rename this file to `prismaClient.d.ts`
      return fs.rename(filePath, path.join(prismaDir, 'prismaClient.d.ts'))
    } else if (fileOrDir !== 'index.ts') {
      // delete the file or folder
      return fs.rm(filePath, { recursive: true })
    }
  })
  await Promise.all(proms)
}

async function rewriteImportsForNodeNext(clientDir: string): Promise<void> {
  const file = path.join(clientDir, 'index.ts')
  const content = await fs.readFile(file, 'utf8')
  const newContent = content
    .replace("from './migrations';", "from './migrations.js';")
    .replace("from './prismaClient';", "from './prismaClient.js';")
  await fs.writeFile(file, newContent)
}

async function withMigrationsConfig(containerName: string) {
  return {
    HTTP_PORT: await getPort(),
    PG_PROXY_PORT: (await getPort()).toString(),
    DATABASE_PORT: await getPort(),
    SERVICE_HOST: 'localhost',
    PG_PROXY_HOST: 'localhost',
    DATABASE_REQUIRE_SSL: false,
    // Random container name to avoid collisions
    CONTAINER_NAME: `${containerName}-migrations-${Math.random()
      .toString(36)
      .slice(6)}`,
  }
}

function stripPasswordFromUrl(url: string): string {
  const parsed = new URL(url)
  if (parsed.password) {
    parsed.password = '********'
  }
  return parsed.toString()
}
