Object.defineProperty(exports, '__esModule', { value: true })

const {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  PrismaClientRustPanicError,
  PrismaClientInitializationError,
  PrismaClientValidationError,
  NotFoundError,
  decompressFromBase64,
  getPrismaClient,
  sqltag,
  empty,
  join,
  raw,
  Decimal,
  Debug,
  objectEnumValues,
  makeStrictEnum,
  Extensions,
  findSync,
} = require('./runtime/library')

const Prisma = {}

exports.Prisma = Prisma

/**
 * Prisma Client JS version: 4.12.0
 * Query Engine version: 659ef412370fa3b41cd7bf6e94587c1dfb7f67e7
 */
Prisma.prismaVersion = {
  client: '4.12.0',
  engine: '659ef412370fa3b41cd7bf6e94587c1dfb7f67e7',
}

Prisma.PrismaClientKnownRequestError = PrismaClientKnownRequestError
Prisma.PrismaClientUnknownRequestError = PrismaClientUnknownRequestError
Prisma.PrismaClientRustPanicError = PrismaClientRustPanicError
Prisma.PrismaClientInitializationError = PrismaClientInitializationError
Prisma.PrismaClientValidationError = PrismaClientValidationError
Prisma.NotFoundError = NotFoundError
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = sqltag
Prisma.empty = empty
Prisma.join = join
Prisma.raw = raw
Prisma.validator = () => (val) => val

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull,
}

const path = require('path')

const fs = require('fs')

// some frameworks or bundlers replace or totally remove __dirname
const hasDirname = typeof __dirname !== 'undefined' && __dirname !== '/'

// will work in most cases, ie. if the client has not been bundled
const regularDirname =
  hasDirname &&
  fs.existsSync(path.join(__dirname, 'schema.prisma')) &&
  __dirname

// if the client has been bundled, we need to look for the folders
const foundDirname =
  !regularDirname &&
  findSync(
    process.cwd(),
    ['test/client/generated/client', 'client/generated/client'],
    ['d'],
    ['d'],
    1
  )[0]

const dirname = regularDirname || foundDirname || __dirname

/**
 * Enums
 */
// Based on
// https://github.com/microsoft/TypeScript/issues/3192#issuecomment-261720275
function makeEnum(x) {
  return x
}

exports.Prisma.ItemsScalarFieldEnum = makeEnum({
  value: 'value',
  nbr: 'nbr',
})

exports.Prisma.PostScalarFieldEnum = makeEnum({
  id: 'id',
  title: 'title',
  contents: 'contents',
  nbr: 'nbr',
  authorId: 'authorId',
})

exports.Prisma.ProfileScalarFieldEnum = makeEnum({
  id: 'id',
  bio: 'bio',
  userId: 'userId',
})

exports.Prisma.QueryMode = makeEnum({
  default: 'default',
  insensitive: 'insensitive',
})

exports.Prisma.SortOrder = makeEnum({
  asc: 'asc',
  desc: 'desc',
})

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable',
})

exports.Prisma.UserScalarFieldEnum = makeEnum({
  id: 'id',
  name: 'name',
})

exports.Prisma.ModelName = makeEnum({
  Items: 'Items',
  User: 'User',
  Post: 'Post',
  Profile: 'Profile',
})

const dmmfString =
  '{"datamodel":{"enums":[],"models":[{"name":"Items","dbName":null,"fields":[{"name":"value","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":false,"type":"String","isGenerated":false,"isUpdatedAt":false},{"name":"nbr","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},{"name":"User","dbName":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","isGenerated":false,"isUpdatedAt":false},{"name":"name","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","isGenerated":false,"isUpdatedAt":false},{"name":"posts","kind":"object","isList":true,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Post","relationName":"PostToUser","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false},{"name":"profile","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Profile","relationName":"ProfileToUser","relationFromFields":[],"relationToFields":[],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},{"name":"Post","dbName":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","isGenerated":false,"isUpdatedAt":false},{"name":"title","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","isGenerated":false,"isUpdatedAt":false},{"name":"contents","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","isGenerated":false,"isUpdatedAt":false},{"name":"nbr","kind":"scalar","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","isGenerated":false,"isUpdatedAt":false},{"name":"authorId","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"Int","isGenerated":false,"isUpdatedAt":false},{"name":"author","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"User","relationName":"PostToUser","relationFromFields":["authorId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false},{"name":"Profile","dbName":null,"fields":[{"name":"id","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":true,"isReadOnly":false,"hasDefaultValue":false,"type":"Int","isGenerated":false,"isUpdatedAt":false},{"name":"bio","kind":"scalar","isList":false,"isRequired":true,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"String","isGenerated":false,"isUpdatedAt":false},{"name":"userId","kind":"scalar","isList":false,"isRequired":true,"isUnique":true,"isId":false,"isReadOnly":true,"hasDefaultValue":false,"type":"Int","isGenerated":false,"isUpdatedAt":false},{"name":"user","kind":"object","isList":false,"isRequired":false,"isUnique":false,"isId":false,"isReadOnly":false,"hasDefaultValue":false,"type":"User","relationName":"ProfileToUser","relationFromFields":["userId"],"relationToFields":["id"],"isGenerated":false,"isUpdatedAt":false}],"primaryKey":null,"uniqueFields":[],"uniqueIndexes":[],"isGenerated":false}],"types":[]},"mappings":{"modelOperations":[{"model":"Items","plural":"items","findUnique":"findUniqueItems","findUniqueOrThrow":"findUniqueItemsOrThrow","findFirst":"findFirstItems","findFirstOrThrow":"findFirstItemsOrThrow","findMany":"findManyItems","create":"createOneItems","createMany":"createManyItems","delete":"deleteOneItems","update":"updateOneItems","deleteMany":"deleteManyItems","updateMany":"updateManyItems","upsert":"upsertOneItems","aggregate":"aggregateItems","groupBy":"groupByItems"},{"model":"User","plural":"users","findUnique":"findUniqueUser","findUniqueOrThrow":"findUniqueUserOrThrow","findFirst":"findFirstUser","findFirstOrThrow":"findFirstUserOrThrow","findMany":"findManyUser","create":"createOneUser","createMany":"createManyUser","delete":"deleteOneUser","update":"updateOneUser","deleteMany":"deleteManyUser","updateMany":"updateManyUser","upsert":"upsertOneUser","aggregate":"aggregateUser","groupBy":"groupByUser"},{"model":"Post","plural":"posts","findUnique":"findUniquePost","findUniqueOrThrow":"findUniquePostOrThrow","findFirst":"findFirstPost","findFirstOrThrow":"findFirstPostOrThrow","findMany":"findManyPost","create":"createOnePost","createMany":"createManyPost","delete":"deleteOnePost","update":"updateOnePost","deleteMany":"deleteManyPost","updateMany":"updateManyPost","upsert":"upsertOnePost","aggregate":"aggregatePost","groupBy":"groupByPost"},{"model":"Profile","plural":"profiles","findUnique":"findUniqueProfile","findUniqueOrThrow":"findUniqueProfileOrThrow","findFirst":"findFirstProfile","findFirstOrThrow":"findFirstProfileOrThrow","findMany":"findManyProfile","create":"createOneProfile","createMany":"createManyProfile","delete":"deleteOneProfile","update":"updateOneProfile","deleteMany":"deleteManyProfile","updateMany":"updateManyProfile","upsert":"upsertOneProfile","aggregate":"aggregateProfile","groupBy":"groupByProfile"}],"otherOperations":{"read":[],"write":["executeRaw","queryRaw"]}}}'
const dmmf = JSON.parse(dmmfString)
exports.Prisma.dmmf = JSON.parse(dmmfString)

/**
 * Create the Client
 */
const config = {
  generator: {
    name: 'client',
    provider: {
      fromEnvVar: null,
      value: 'prisma-client-js',
    },
    output: {
      value:
        '/Users/kevin/Documents/Electric/development/typescript-client/test/client/generated/client',
      fromEnvVar: null,
    },
    config: {
      engineType: 'library',
    },
    binaryTargets: [],
    previewFeatures: [],
    isCustomOutput: true,
  },
  relativeEnvPaths: {
    rootEnvPath: null,
  },
  relativePath: '../../prisma',
  clientVersion: '4.12.0',
  engineVersion: '659ef412370fa3b41cd7bf6e94587c1dfb7f67e7',
  datasourceNames: ['db'],
  activeProvider: 'postgresql',
  dataProxy: false,
}
config.dirname = dirname
config.document = dmmf

const { warnEnvConflicts } = require('./runtime/library')

warnEnvConflicts({
  rootEnvPath:
    config.relativeEnvPaths.rootEnvPath &&
    path.resolve(dirname, config.relativeEnvPaths.rootEnvPath),
  schemaEnvPath:
    config.relativeEnvPaths.schemaEnvPath &&
    path.resolve(dirname, config.relativeEnvPaths.schemaEnvPath),
})

const PrismaClient = getPrismaClient(config)
exports.PrismaClient = PrismaClient
Object.assign(exports, Prisma)

path.join(__dirname, 'libquery_engine-darwin-arm64.dylib.node')
path.join(
  process.cwd(),
  'test/client/generated/client/libquery_engine-darwin-arm64.dylib.node'
)
path.join(__dirname, 'schema.prisma')
path.join(process.cwd(), 'test/client/generated/client/schema.prisma')
