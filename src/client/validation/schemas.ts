import { z, ZodRawShape } from 'zod'
import mapValues from 'lodash.mapvalues'
import { InvalidArgumentError } from './errors/invalidArgumentError'
import { toZod } from '../util/toZod'

export type ZObject<T> = z.ZodObject<
  { [k in keyof T]-?: toZod<T[k]> },
  'strict',
  z.ZodTypeAny,
  T,
  T
>

/**
 * Takes a schema for objects of type `T` and returns a schema for objects of type `CreateInput<T>`
 * @param schema Schema for object of type `T`
 * @param tableName Name of the table that is being queried.
 */
export function makeCreateInputSchema<T>(
  tableName: string,
  schema: ZObject<T>
) {
  return z
    .object({
      data: schema,
      select: makeSelectSchema(tableName, schema).optional(),
    })
    .strict()
}

/**
 * Takes a schema for objects of type `T` and returns a schema for objects of type `CreateInput<T[]>`
 * @param schema Schema for object of type `T`
 * @param tableName Name of the table that is being queried.
 */
export function makeCreateManyInputSchema<T>(schema: ZObject<T>) {
  return z
    .object({
      data: schema.array(),
      skipDuplicates: z.boolean().default(false),
    })
    .strict()
}

/**
 * Takes a schema for objects of type `T` and returns a schema for objects of type `FindInput<T>`
 * @param schema Schema for object of type `T`
 * @param tableName Name of the table that is being queried.
 */
export function makeFindInputSchema<T>(tableName: string, schema: ZObject<T>) {
  const negativeTakeError = new InvalidArgumentError(
    `A negative value for the take argument is not yet supported.`
  )
  const negativeSkipError = new InvalidArgumentError(
    `Invalid value for skip argument, value must be positive.`
  )
  const nonNegSchema = (err: Error) =>
    z.number().int().nonnegative(err).optional()

  return z
    .object({
      where: makeWhereSchema(schema),
      select: makeSelectSchema(tableName, schema).optional(),
      distinct: z.string().array().optional(), // optional array of strings
      take: nonNegSchema(negativeTakeError), // optional number >= 0
      skip: nonNegSchema(negativeSkipError), // optional number >= 0
      orderBy: makeOrderBySchema(tableName, schema).optional(),
    })
    .strict()
}

/**
 * Takes a schema for objects of type `T` and returns a schema for objects of type `FindUniqueInput<T>`
 * @param schema Schema for object of type `T`
 * @param tableName Name of the table that is being queried.
 */
export function makeFindUniqueInputSchema<T>(
  tableName: string,
  schema: ZObject<T>
) {
  return z
    .object({
      where: schema.partial(), // Partial<T>
      select: makeSelectSchema(tableName, schema).optional(),
    })
    .strict()
}

export function makeUpdateInputSchema<T>(
  tableName: string,
  schema: ZObject<T>
) {
  const dataSchema = makePartialDataSchema(schema)
  const findUniqueSchema = makeFindUniqueInputSchema(tableName, schema)
  return dataSchema.merge(findUniqueSchema)
}

export function makeUpdateManyInputSchema<T>(schema: ZObject<T>) {
  return z.object({
    data: schema.partial(),
    where: makeWhereSchema(schema),
  })
}

export function makeUpsertInputSchema<T>(
  tableName: string,
  schema: ZObject<T>
) {
  return z
    .object({
      create: schema,
      update: schema.partial(),
      where: schema.partial(),
      select: makeSelectSchema(tableName, schema).optional(),
    })
    .strict()
}

export function makeDeleteInputSchema<T>(
  tableName: string,
  schema: ZObject<T>
) {
  return z
    .object({
      where: schema.partial(),
      select: makeSelectSchema(tableName, schema).optional(),
    })
    .strict()
}

export function makeDeleteManyInputSchema<T>(schema: ZObject<T>) {
  return z
    .object({
      where: makeWhereSchema(schema),
    })
    .strict()
}

function makePartialDataSchema<T>(schema: ZObject<T>) {
  return z
    .object({
      data: schema.partial(),
    })
    .strict()
}

function makeWhereSchema<T>(schema: ZObject<T>) {
  const partialSchema = schema.partial().strict() // Partial<T>
  return partialSchema.default({} as z.input<typeof partialSchema>)
}

function makeOrderBySchema<T>(tableName: string, schema: ZObject<T>) {
  const orderEnum = z.enum(['asc', 'desc'])
  const errorMsg = new InvalidArgumentError(
    `Value for 'orderBy' argument is not of type 'OrderByInput<${tableName}>'`
  )
  const orderBySchema = modifySchemaTypes(schema, orderEnum, errorMsg) // schema for `OrderByInput<T>` objects
  const orderByArraySchema = orderBySchema.array() // schema for an array of `OrderByInput<T>` objects
  // The orderBy argument can take either an `OrderByInput<T>` object or an array of `OrderByInput<T>` objects
  return z.union([orderBySchema, orderByArraySchema])
}

/**
 * Makes a Zod schema for `SelectInput<T>` objects based on a schema for objects of type `T`
 * @tparam T Type that represents the table being queried
 * @param schema Schema for objects of type `T`
 * @param tableName Name of the table `T` that is being queried
 */
function makeSelectSchema<T>(tableName: string, schema: ZObject<T>) {
  const errorMsg = new InvalidArgumentError(
    `Value for 'select' argument is not of type 'SelectInput<${tableName}>'`
  )
  return modifySchemaTypes(schema, z.boolean(), errorMsg) // schema for `SelectInput<T>` objects
}

/**
 * This function takes a schema and a Zod type and modifies the type of the fields in the schema to the provided Zod type.
 * e.g. `modifySchemaTypes(z.object({ id: z.string() }), z.number()) = z.object({ id: z.number() })`
 */
function modifySchemaTypes<T>(
  schema: ZObject<T>,
  tpe: z.ZodTypeAny,
  errMsg: Error
) {
  // Take the existing schema for T and modify the field types to the provided `tpe`
  const shape: ZodRawShape = schema.shape
  const orderShape = mapValues(shape, (_o: any) => tpe)
  // Create a new schema
  return schema
    .extend(orderShape) // modify the shape to the new types
    .partial() // not all fields must be provided
    .strict(errMsg) // disallow unrecognized fields
}
