import mapValues from 'lodash.mapvalues'
import { FieldName, Fields } from '../model/schema.js'
import { fromSqlite, toSqlite, isDataObject } from './sqlite.js'
import { InvalidArgumentError } from '../validation/errors/invalidArgumentError.js'
import { mapObject } from '../util/functions.js'
import { PgType } from './types.js'

export enum Transformation {
  Js2Sqlite,
  Sqlite2Js,
}

type UpdateInput = { data: object; where: object }
type UpdateManyInput = { data: object; where?: object }
type CreateInput = { data: object }
type CreateManyInput = { data: Array<object> }
type UpsertInput = { update: object; create: object; where: object }
type WhereUniqueInput = { where: object }
type WhereInput = { where?: object }

type Swap<T, Input, Props extends keyof Input> = Omit<T, Props> &
  Pick<Input, Props>

/**
 * Takes the data input of a `create` operation and
 * converts the JS values to their corresponding SQLite values.
 * e.g. JS `Date` objects are converted into strings.
 * @param i The validated input of the `create` operation.
 * @param fields The table's fields.
 * @returns The transformed input.
 */
export function transformCreate<T extends CreateInput>(
  i: T,
  fields: Fields
): Swap<T, CreateInput, 'data'> {
  return {
    ...i,
    data: transformFields(i.data, fields),
  }
}

/**
 * Takes the data input of a `createMany` operation and
 * converts the JS values to their corresponding SQLite values.
 * e.g. JS `Date` objects are converted into strings.
 * @param i The validated input of the `createMany` operation.
 * @param fields The table's fields.
 * @returns The transformed input.
 */
export function transformCreateMany<T extends CreateManyInput>(
  i: T,
  fields: Fields
): Swap<T, CreateManyInput, 'data'> {
  return {
    ...i,
    data: i.data.map((o) => transformFields(o, fields)),
  }
}

/**
 * Takes the data input of an `update` operation and
 * converts the JS values to their corresponding SQLite values.
 * e.g. JS `Date` objects are converted into strings.
 * @param i The validated input of the `update` operation.
 * @param fields The table's fields.
 * @returns The transformed input.
 */
export function transformUpdate<T extends UpdateInput>(
  i: T,
  fields: Fields
): Swap<T, UpdateInput, 'data' | 'where'> {
  return {
    ...i,
    data: transformFields(i.data, fields),
    where: transformWhere(i.where, fields),
  }
}

/**
 * Takes the data input of an `updateMany` operation and
 * converts the JS values to their corresponding SQLite values.
 * @param i The validated input of the `updateMany` operation.
 * @param fields The table's fields.
 * @returns The transformed input.
 */
export function transformUpdateMany<T extends UpdateManyInput>(
  i: T,
  fields: Fields
): UpdateManyInput {
  const whereObj = transformWhereInput(i, fields)
  return {
    ...whereObj,
    data: transformFields(i.data, fields),
  }
}

/**
 * Takes the data input of an `upsert` operation and
 * converts the JS values to their corresponding SQLite values.
 * @param i The validated input of the `upsert` operation.
 * @param fields The table's fields.
 * @returns The transformed input.
 */
export function transformUpsert<T extends UpsertInput>(
  i: T,
  fields: Fields
): Swap<T, UpsertInput, 'update' | 'create' | 'where'> {
  return {
    ...i,
    update: transformFields(i.update, fields),
    create: transformFields(i.create, fields),
    where: transformWhere(i.where, fields),
  }
}

/**
 * Takes the data input of a `delete` operation and
 * converts the JS values to their corresponding SQLite values.
 */
export const transformDelete = transformWhereUniqueInput

/**
 * Takes the data input of a `deleteMany` operation and
 * converts the JS values to their corresponding SQLite values.
 * @param i The validated input of the `deleteMany` operation.
 * @param fields The table's fields.
 * @returns The transformed input.
 */
export const transformDeleteMany = transformWhereInput

/**
 * Takes the data input of a `findUnique` operation and
 * converts the JS values to their corresponding SQLite values.
 */
export const transformFindUnique = transformWhereUniqueInput

/**
 * Takes the data input of a `findFirst` or `findMany` operation and
 * converts the JS values to their corresponding SQLite values.
 */
export const transformFindNonUnique = transformWhereInput

/**
 * Takes the data input of an operation containing a required `where` clause and
 * converts the JS values of the `where` clause to their corresponding SQLite values.
 * @param i The validated input of the `where` clause.
 * @param fields The table's fields.
 * @returns The transformed input.
 */
function transformWhereUniqueInput<T extends WhereUniqueInput>(
  i: T,
  fields: Fields
): Swap<T, WhereUniqueInput, 'where'> {
  return {
    ...i,
    where: transformWhere(i.where, fields),
  }
}

/**
 * Takes the data input of an operation containing an optional `where` clause and
 * converts the JS values of the `where` clause to their corresponding SQLite values.
 * @param i The validated input of the `where` clause.
 * @param fields The table's fields.
 * @returns The transformed input.
 */
function transformWhereInput<T extends WhereInput>(
  i: T,
  fields: Fields
): Swap<T, WhereInput, 'where'> {
  const whereObj = i.where ? { where: transformWhere(i.where, fields) } : {}
  return {
    ...i,
    ...whereObj,
  }
}

/**
 * Iterates over the properties of the object `o`
 * in order to transform their values to SQLite compatible values
 * based on additional type information about the fields.
 * @param o The object to transform.
 * @param fields Type information about the fields.
 * @param transformation Which transformation to execute.
 * @returns An object with the values converted to SQLite.
 */
export function transformFields(
  o: object,
  fields: Fields,
  transformation: Transformation = Transformation.Js2Sqlite
): object {
  // only transform fields that are part of this table and not related fields
  // as those will be transformed later when the query on the related field is processed.
  const fieldsAndValues = Object.entries(keepTableFieldsOnly(o, fields))
  const fieldsAndTransformedValues = fieldsAndValues.map((entry) => {
    const [field, value] = entry
    return transformField(field, value, o, fields, transformation)
  })
  return {
    ...o,
    ...Object.fromEntries(fieldsAndTransformedValues),
  }
}

/**
 * Transforms the provided value into a SQLite compatible value
 * based on the type of this field.
 * @param field The name of the field.
 * @param value The value of the field.
 * @param o The object to which the field belongs.
 * @param fields Type information about the object's fields.
 * @param transformation Which transformation to execute.
 * @returns The transformed field.
 */
function transformField(
  field: FieldName,
  value: any,
  o: object,
  fields: Fields,
  transformation: Transformation = Transformation.Js2Sqlite
): any {
  const pgType = fields.get(field)

  if (!pgType)
    throw new InvalidArgumentError(
      `Unknown field ${field} in object ${JSON.stringify(o)}`
    )

  const transformedValue =
    transformation === Transformation.Js2Sqlite
      ? toSqlite(value, pgType)
      : fromSqlite(value, pgType)

  return [field, transformedValue]
}

function transformWhere(o: object, fields: Fields): object {
  const transformedFields = transformWhereFields(o, fields)
  const transformedBooleanConnectors = transformBooleanConnectors(o, fields)
  return {
    ...o,
    ...transformedFields,
    ...transformedBooleanConnectors,
  }
}

function transformBooleanConnectors(
  o: {
    AND?: object | object[]
    OR?: object | object[]
    NOT?: object | object[]
  },
  fields: Fields
): object {
  // Within a `where` object, boolean connectors AND/OR/NOT will contain
  // a nested `where` object or an array of nested `where` objects
  // if it is a single `where` object we wrap it in an array
  // and we map `transformWhere` to recursively handle all nested objects
  const makeArray = (v: any) => (Array.isArray(v) ? v : [v])
  const andObj = o.AND
    ? { AND: makeArray(o.AND).map((x) => transformWhere(x, fields)) }
    : {}
  const orObj = o.OR
    ? { OR: makeArray(o.OR).map((x) => transformWhere(x, fields)) }
    : {}
  const notObj = o.NOT
    ? { NOT: makeArray(o.NOT).map((x) => transformWhere(x, fields)) }
    : {}

  // we use spread syntax such that the filter is not included if it is undefined
  // we cannot set it to undefined because then it appears in `hasOwnProperty`
  // and the query builder will try to write `undefined` to the database.
  return {
    ...andObj,
    ...orObj,
    ...notObj,
  }
}

/**
 * Iterates over the properties of a `where` object
 * in order to transform the values to SQLite compatible values
 * based on additional type information about the fields.
 * @param o The `where` object to transform.
 * @param fields Type information about the fields.
 * @returns A `where` object with the values converted to SQLite.
 */
function transformWhereFields(o: object, fields: Fields): object {
  // only transform fields that are part of this table and not related fields
  // as those will be transformed later when the query on the related field is processed.
  const objWithoutRelatedFields = keepTableFieldsOnly(o, fields)
  const transformedObj = mapObject(objWithoutRelatedFields, (field, value) => {
    // each field can be the value itself or an object containing filters like `lt`, `gt`, etc.
    return transformFieldsAllowingFilters(field, value, fields)
  })

  return {
    ...o,
    ...transformedObj,
  }
}

/**
 * Transforms a value that may contain filters.
 * e.g. `where` clauses of a query allow to pass a value directly or an object containing filters.
 *      If it is an object of filters, we need to transform the values that are nested in those filters.
 * @param field The name of the field we are transforming.
 * @param value The value for that field.
 * @param fields Type information about the fields of this table.
 * @returns The transformed value.
 */
function transformFieldsAllowingFilters(
  field: FieldName,
  value: any,
  fields: Fields
): any {
  const pgType = fields.get(field)

  if (!pgType) throw new InvalidArgumentError(`Unknown field ${field}`)

  if (isFilterObject(value)) {
    // transform the values that are nested in those filters
    return transformFilterObject(field, value, pgType, fields)
  }

  return toSqlite(value, pgType)
}

function isObject(v: any): boolean {
  return typeof v === 'object' && !Array.isArray(v) && v !== null
}

function isFilterObject(value: any): boolean {
  // if it is an object it can only be a timestamp or a filter object
  // because those are the only objects we support in where clauses
  return isObject(value) && !isDataObject(value)
}

/**
 * Transforms an object containing filters
 * @example For example:
 * ```
 * {
 *   lt: Date('2023-09-12'),
 *   notIn: [ Date('2023-09-09'), Date('2023-09-01') ],
 *   not: {
 *     lt: Date('2022-09-01')
 *   }
 * }
 * ```
 * @param field The name of the field we are transforming.
 * @param o The object containing the filters.
 * @param pgType Type of this field.
 * @param fields Type information about the fields of this table.
 * @returns A transformed filter object.
 */
function transformFilterObject(
  field: FieldName,
  o: any,
  pgType: PgType,
  fields: Fields
) {
  const simpleFilters = new Set(['equals', 'lt', 'lte', 'gt', 'gte']) // filters whose value is an optional value of type `pgType`
  const arrayFilters = new Set(['in', 'notIn']) // filters whose value is an optional array of values of type `pgType`

  // Handle the simple filters
  const simpleFilterObj = filterKeys(o, simpleFilters)
  const transformedSimpleFilterObj = mapValues(simpleFilterObj, (v: any) =>
    toSqlite(v, pgType)
  )

  // Handle the array filters
  const arrayFilterObj = filterKeys(o, arrayFilters)
  const transformedArrayFilterObj = mapValues(arrayFilterObj, (arr) =>
    arr.map((v: any) => toSqlite(v, pgType))
  )

  // Handle `not` filter
  // `not` is a special one as it accepts a value or a nested object of filters
  // hence it is just like the properties of a `where` object which accept values or filters
  const notFilterObj = filterKeys(o, new Set(['not']))
  const transformedNotFilterObj = mapValues(notFilterObj, (v) => {
    // each field can be the value itself or an object containing filters like `lt`, `gt`, etc.
    return transformFieldsAllowingFilters(field, v, fields)
  })

  return {
    ...o,
    ...transformedSimpleFilterObj,
    ...transformedArrayFilterObj,
    ...transformedNotFilterObj,
  }
}

/**
 * Filters out all properties that are not fields (i.e. columns) of this table.
 * e.g. it removes related fields or filters like `lt`, `equals`, etc.
 * @param o The object to filter.
 * @param fields The fields of the table to which this object belongs.
 * @returns A filtered object.
 */
function keepTableFieldsOnly(o: object, fields: Fields) {
  return filterKeys(o, new Set(fields.keys()))
}

/**
 * Filters the object to retain only keys that are in `keys`.
 * @param o The object to filter.
 * @param keys The keys to keep.
 * @returns A filtered object.
 */
function filterKeys(o: object, keys: Set<string>) {
  return Object.fromEntries(
    Object.entries(o).filter((entry) => keys.has(entry[0]))
  )
}
