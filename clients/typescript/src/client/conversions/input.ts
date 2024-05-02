import mapValues from 'lodash.mapvalues'
import { FieldName, Fields } from '../model/schema'
import { Converter, isDataObject } from './converter'
import { InvalidArgumentError } from '../validation/errors/invalidArgumentError'
import { mapObject } from '../util/functions'
import { PgType } from './types'
import { isObject } from '../../util'

export enum Transformation {
  Encode, // encode values from JS to SQLite/Postgres
  Decode, // decode values from SQLite/Postgres to JS
}

type UpdateInput = { data: object; where: object }
type UpdateManyInput = { data: object; where?: object }
type CreateInput = { data: object }
type CreateManyInput = { data: Array<object> }
type WhereUniqueInput = { where: object }
type WhereInput = { where?: object }

type Swap<T, Input, Props extends keyof Input> = Omit<T, Props> &
  Pick<Input, Props>

export class InputTransformer {
  constructor(public converter: Converter) {}

  /**
   * Takes the data input of a `create` operation and
   * converts the JS values to their corresponding SQLite/PG values.
   * e.g. JS `Date` objects are converted into strings.
   * @param i The validated input of the `create` operation.
   * @param fields The table's fields.
   * @returns The transformed input.
   */
  transformCreate<T extends CreateInput>(
    i: T,
    fields: Fields
  ): Swap<T, CreateInput, 'data'> {
    return {
      ...i,
      data: transformFields(i.data, fields, this.converter),
    }
  }

  /**
   * Takes the data input of a `createMany` operation and
   * converts the JS values to their corresponding SQLite/PG values.
   * e.g. JS `Date` objects are converted into strings.
   * @param i The validated input of the `createMany` operation.
   * @param fields The table's fields.
   * @returns The transformed input.
   */
  transformCreateMany<T extends CreateManyInput>(
    i: T,
    fields: Fields
  ): Swap<T, CreateManyInput, 'data'> {
    return {
      ...i,
      data: i.data.map((o) => transformFields(o, fields, this.converter)),
    }
  }

  /**
   * Takes the data input of an `update` operation and
   * converts the JS values to their corresponding SQLite/PG values.
   * e.g. JS `Date` objects are converted into strings.
   * @param i The validated input of the `update` operation.
   * @param fields The table's fields.
   * @returns The transformed input.
   */
  transformUpdate<T extends UpdateInput>(
    i: T,
    fields: Fields
  ): Swap<T, UpdateInput, 'data' | 'where'> {
    return {
      ...i,
      data: transformFields(i.data, fields, this.converter),
      where: this.transformWhere(i.where, fields),
    }
  }

  /**
   * Takes the data input of an `updateMany` operation and
   * converts the JS values to their corresponding SQLite/PG values.
   * @param i The validated input of the `updateMany` operation.
   * @param fields The table's fields.
   * @returns The transformed input.
   */
  transformUpdateMany<T extends UpdateManyInput>(
    i: T,
    fields: Fields
  ): UpdateManyInput {
    const whereObj = this.transformWhereInput(i, fields)
    return {
      ...whereObj,
      data: transformFields(i.data, fields, this.converter),
    }
  }

  /**
   * Takes the data input of a `delete` operation and
   * converts the JS values to their corresponding SQLite/PG values.
   */
  transformDelete = this.transformWhereUniqueInput

  /**
   * Takes the data input of a `deleteMany` operation and
   * converts the JS values to their corresponding SQLite/PG values.
   * @param i The validated input of the `deleteMany` operation.
   * @param fields The table's fields.
   * @returns The transformed input.
   */
  transformDeleteMany = this.transformWhereInput

  /**
   * Takes the data input of a `findUnique` operation and
   * converts the JS values to their corresponding SQLite/PG values.
   */
  transformFindUnique = this.transformWhereUniqueInput

  /**
   * Takes the data input of a `findFirst` or `findMany` operation and
   * converts the JS values to their corresponding SQLite/PG values.
   */
  transformFindNonUnique = this.transformWhereInput

  /**
   * Takes the data input of an operation containing a required `where` clause and
   * converts the JS values of the `where` clause to their corresponding SQLite/PG values.
   * @param i The validated input of the `where` clause.
   * @param fields The table's fields.
   * @returns The transformed input.
   */
  transformWhereUniqueInput<T extends WhereUniqueInput>(
    i: T,
    fields: Fields
  ): Swap<T, WhereUniqueInput, 'where'> {
    return {
      ...i,
      where: this.transformWhere(i.where, fields),
    }
  }

  /**
   * Takes the data input of an operation containing an optional `where` clause and
   * converts the JS values of the `where` clause to their corresponding SQLite/PG values.
   * @param i The validated input of the `where` clause.
   * @param fields The table's fields.
   * @returns The transformed input.
   */
  transformWhereInput<T extends WhereInput>(
    i: T,
    fields: Fields
  ): Swap<T, WhereInput, 'where'> {
    const whereObj = i.where
      ? { where: this.transformWhere(i.where, fields) }
      : {}
    return {
      ...i,
      ...whereObj,
    }
  }

  transformWhere(o: object, fields: Fields): object {
    const transformedFields = this.transformWhereFields(o, fields)
    const transformedBooleanConnectors = this.transformBooleanConnectors(
      o,
      fields
    )
    return {
      ...o,
      ...transformedFields,
      ...transformedBooleanConnectors,
    }
  }

  transformBooleanConnectors(
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
      ? { AND: makeArray(o.AND).map((x) => this.transformWhere(x, fields)) }
      : {}
    const orObj = o.OR
      ? { OR: makeArray(o.OR).map((x) => this.transformWhere(x, fields)) }
      : {}
    const notObj = o.NOT
      ? { NOT: makeArray(o.NOT).map((x) => this.transformWhere(x, fields)) }
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
   * in order to transform the values to SQLite/PG compatible values
   * based on additional type information about the fields.
   * @param o The `where` object to transform.
   * @param fields Type information about the fields.
   * @returns A `where` object with the values converted to SQLite/PG.
   */
  transformWhereFields(o: object, fields: Fields): object {
    // only transform fields that are part of this table and not related fields
    // as those will be transformed later when the query on the related field is processed.
    const objWithoutRelatedFields = keepTableFieldsOnly(o, fields)
    const transformedObj = mapObject(
      objWithoutRelatedFields,
      (field, value) => {
        // each field can be the value itself or an object containing filters like `lt`, `gt`, etc.
        return this.transformFieldsAllowingFilters(field, value, fields)
      }
    )

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
  transformFieldsAllowingFilters(
    field: FieldName,
    value: any,
    fields: Fields
  ): any {
    const pgType = fields.get(field)

    if (!pgType) throw new InvalidArgumentError(`Unknown field ${field}`)

    if (isFilterObject(value)) {
      // transform the values that are nested in those filters
      return this.transformFilterObject(field, value, pgType, fields)
    }

    return this.converter.encode(value, pgType)
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
  transformFilterObject(
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
      this.converter.encode(v, pgType)
    )

    // Handle the array filters
    const arrayFilterObj = filterKeys(o, arrayFilters)
    const transformedArrayFilterObj = mapValues(arrayFilterObj, (arr) =>
      arr.map((v: any) => this.converter.encode(v, pgType))
    )

    // Handle `not` filter
    // `not` is a special one as it accepts a value or a nested object of filters
    // hence it is just like the properties of a `where` object which accept values or filters
    const notFilterObj = filterKeys(o, new Set(['not']))
    const transformedNotFilterObj = mapValues(notFilterObj, (v) => {
      // each field can be the value itself or an object containing filters like `lt`, `gt`, etc.
      return this.transformFieldsAllowingFilters(field, v, fields)
    })

    return {
      ...o,
      ...transformedSimpleFilterObj,
      ...transformedArrayFilterObj,
      ...transformedNotFilterObj,
    }
  }
}

/**
 * Iterates over the properties of the object `o`
 * in order to transform their values to SQLite/PG compatible values
 * based on additional type information about the fields.
 * @param o The object to transform.
 * @param fields Type information about the fields.
 * @param transformation Which transformation to execute.
 * @returns An object with the values converted to SQLite/PG.
 */
export function transformFields(
  o: object,
  fields: Fields,
  converter: Converter,
  transformation: Transformation = Transformation.Encode
): object {
  // only transform fields that are part of this table and not related fields
  // as those will be transformed later when the query on the related field is processed.
  const copied: Record<string, any> = { ...o }
  Object.entries(o).forEach(([field, value]) => {
    const pgType = fields.get(field)
    // Skip anything that's not an actual column on the table
    if (pgType === undefined) return

    const transformedValue =
      transformation === Transformation.Encode
        ? converter.encode(value, pgType)
        : converter.decode(value, pgType)

    copied[field] = transformedValue
  })

  return copied
}

export function isFilterObject(value: any): boolean {
  // if it is an object it can only be a data object or a filter object
  return isObject(value) && !isDataObject(value)
}

/**
 * Filters out all properties that are not fields (i.e. columns) of this table.
 * e.g. it removes related fields or filters like `lt`, `equals`, etc.
 * @param o The object to filter.
 * @param fields The fields of the table to which this object belongs.
 * @returns A filtered object.
 */
function keepTableFieldsOnly(o: object, fields: Fields) {
  return filterKeys(o, fields)
}

/**
 * Filters the object to retain only keys that are in `keys`.
 * @param o The object to filter.
 * @param keys Object that allows checking if a key is present.
 * @returns A filtered object.
 */
function filterKeys(o: object, keys: { has: (x: string) => boolean }) {
  return Object.fromEntries(
    Object.entries(o).filter((entry) => keys.has(entry[0]))
  )
}
