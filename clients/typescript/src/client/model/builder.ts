import { CreateInput, CreateManyInput } from '../input/createInput.js'
import squel, {
  PostgresSelect,
  QueryBuilder,
  ReturningMixin,
  WhereMixin,
} from 'squel'
import { FindInput, FindUniqueInput } from '../input/findInput.js'
import { UpdateInput, UpdateManyInput } from '../input/updateInput.js'
import { DeleteInput, DeleteManyInput } from '../input/deleteInput.js'
import flow from 'lodash.flow'
import { InvalidArgumentError } from '../validation/errors/invalidArgumentError.js'
import * as z from 'zod'
import { IShapeManager } from './shapes.js'
import Log from 'loglevel'

const squelPostgres = squel.useFlavour('postgres')

type AnyFindInput = FindInput<any, any, any, any, any>

export class Builder {
  constructor(
    private _tableName: string,
    private _fields: string[],
    private shapeManager: IShapeManager
  ) {}

  create(i: CreateInput<any, any, any>): QueryBuilder {
    // Make a SQL query out of the data
    const query = squelPostgres.insert().into(this._tableName).setFields(i.data)

    // Adds a `RETURNING` statement that returns all known fields
    const queryWithReturn = this.returnAllFields(query)
    return queryWithReturn
  }

  createMany(i: CreateManyInput<any>): QueryBuilder {
    const insert = squelPostgres
      .insert()
      .into(this._tableName)
      .setFieldsRows(i.data)
    return i.skipDuplicates
      ? insert.onConflict() // adds "ON CONFLICT DO NOTHING" to the query
      : insert
  }

  findUnique(i: FindUniqueInput<any, any, any>): QueryBuilder {
    return this.findWhere({ ...i, take: 2 }, true) // take 2 such that we can throw an error if more than one record matches
  }

  findFirst(i: AnyFindInput): QueryBuilder {
    return this.findWhere({ ...i, take: 1 })
  }

  findMany(i: AnyFindInput): QueryBuilder {
    return this.findWhere(i)
  }

  // Finds a record but does not select the fields provided in the `where` argument
  // whereas `findUnique`, `findFirst`, and `findMany` also automatically select the fields in `where`
  findWithoutAutoSelect(i: AnyFindInput): QueryBuilder {
    return this.findWhere(i, false, false)
  }

  update(i: UpdateInput<any, any, any, any>): QueryBuilder {
    return this.updateInternal(i, true)
  }

  updateMany(i: UpdateManyInput<any, any>): QueryBuilder {
    return this.updateInternal(i)
  }

  delete(i: DeleteInput<any, any, any>): QueryBuilder {
    return this.deleteInternal(i, true)
  }

  deleteMany(i: DeleteManyInput<any>): QueryBuilder {
    return this.deleteInternal(i)
  }

  private deleteInternal(
    i: DeleteManyInput<any>,
    idRequired = false
  ): QueryBuilder {
    const deleteQuery = squel.delete().from(this._tableName)
    const whereObject = i.where // safe because the schema for `where` adds an empty object as default which is provided if the `where` field is absent
    const fields = this.getFields(whereObject, idRequired)
    return addFilters(fields, whereObject, deleteQuery)
  }

  private updateInternal(
    i: UpdateManyInput<any, any>,
    idRequired = false
  ): QueryBuilder {
    const unsupportedEntry = Object.entries(i.data).find((entry) => {
      const [_key, value] = entry
      return typeof value === 'object' && value !== null
    })
    if (unsupportedEntry)
      throw new InvalidArgumentError(
        `Unsupported value ${JSON.stringify(unsupportedEntry[1])} for field "${
          unsupportedEntry[0]
        }" in update query.`
      )

    const query = squelPostgres
      .update()
      .table(this._tableName)
      .setFields(i.data)

    // Adds a `RETURNING` statement that returns all known fields
    const queryWithReturn = this.returnAllFields(query)

    const whereObject = i.where // safe because the schema for `where` adds an empty object as default which is provided if the `where` field is absent
    const fields = this.getFields(whereObject, idRequired)
    return addFilters(fields, whereObject, queryWithReturn)
  }

  /**
   * Creates a `SELECT fields FROM table WHERE conditions` query.
   * @param i Object containing optional `where` and `selection` fields.
   * @param idRequired If true, will throw an error if no fields are provided in the `where` argument.
   * @param selectWhereFields By default, `findWhere` selects the fields provided in the `where` argument. By providing `false` it will not automatically select those fields.
   */
  private findWhere(
    i: FindInput<any, any, any, any, any>,
    idRequired = false,
    selectWhereFields = true
  ): QueryBuilder {
    if ('cursor' in i && typeof i.cursor !== 'undefined') {
      throw new InvalidArgumentError('Unsupported cursor argument.')
    }

    const whereObject = i.where
    const identificationFields = this.getFields(whereObject, idRequired)

    if (!this.shapeManager.hasBeenSubscribed(this._tableName))
      Log.debug('Reading from unsynced table ' + this._tableName)

    const query = squelPostgres.select().from(this._tableName) // specify from which table to select
    // only select the fields provided in `i.select` and the ones in `i.where`
    const addFieldSelectionP = this.addFieldSelection.bind(
      this,
      i,
      selectWhereFields ? identificationFields : []
    )
    // add a where clause to filter on the conditions provided in `i.where`
    const addFiltersP = addFilters.bind(null, identificationFields, whereObject)
    const addLimitP = addLimit.bind(null, i)
    const addOffsetP = addOffset.bind(null, i)
    const addDistinctP = addDistinct.bind(null, i)
    const addOrderByP = this.addOrderBy.bind(this, i)
    const buildQuery = flow(
      addFieldSelectionP,
      addFiltersP,
      addLimitP,
      addOffsetP,
      addDistinctP,
      addOrderByP
    )
    return buildQuery(query)
  }

  private addFieldSelection(
    i: AnyFindInput,
    identificationFields: string[],
    q: PostgresSelect
  ): PostgresSelect {
    if (typeof i.select === 'undefined') {
      // Select all known fields explicitly
      // which is safer than executing a SELECT * query
      i.select = {}
      this._fields.forEach((field) => {
        i.select[field as keyof typeof i.select] = true
      })
    }

    const selectedFields = getSelectedFields(i.select)
    if (selectedFields.length == 0)
      throw new InvalidArgumentError(
        `The \`select\` statement for type ${this._tableName} needs at least one truthy value.`
      )

    const unknownField: string | undefined = selectedFields.find(
      (f) => !this._fields.includes(f)
    )
    if (unknownField) {
      // query selects a field that does not exist on this table
      throw new InvalidArgumentError(
        `Cannot select field ${unknownField} on table ${this._tableName}. Use 'include' to fetch related objects.`
      )
    }

    // the filter below removes boolean filters like AND, OR, NOT
    // which are not columns and thus should not be selected
    const fields = identificationFields
      .filter((f) => this._fields.includes(f))
      .concat(selectedFields)

    return q.fields(fields)
  }

  private addOrderBy(i: AnyFindInput, q: PostgresSelect): PostgresSelect {
    if (typeof i.orderBy === 'undefined') return q
    const orderByArray = Array.isArray(i.orderBy) ? i.orderBy : [i.orderBy]

    return orderByArray.reduce((query: PostgresSelect, orderBy: object) => {
      // Don't accept more than one field in `fieldOrdering` because we can't infer the order of those fields!
      // If we need to order on several fields, they should be provided as several OrderByInput objects in an array.
      const fields = Object.keys(orderBy)
      if (fields.length > 1)
        throw new InvalidArgumentError(
          `Argument 'orderBy' can have at most one field per 'OrderByInput' object. Consider providing several 'OrderByInput' objects in an array.`
        )
      if (fields.length === 0) return query

      const field = fields[0]
      const order = orderBy[field as keyof object]

      if (typeof order === 'object' && order !== null)
        throw new InvalidArgumentError(
          `Ordering query results based on the '${field}' related object(s) is not yet supported`
        )

      const squelOrder = order === 'asc' // squel expects 'true' for ascending order, 'false' for descending order
      return query.order(field, squelOrder)
    }, q)
  }

  private getFields(whereObject?: object, fieldsRequired = false) {
    const obj = typeof whereObject !== 'undefined' ? whereObject : {} // provide empty object if no `where` argument is provided
    const fields = Object.keys(obj)

    if (fieldsRequired && fields.length == 0)
      throw new InvalidArgumentError(
        `Argument \`where\` for query on ${this._tableName} type requires at least one argument.`
      )

    return fields
  }

  private returnAllFields<T extends QueryBuilder & ReturningMixin>(
    query: T
  ): T {
    return this._fields.reduce((query, field) => {
      return query.returning(field)
    }, query)
  }
}

/**
 * Adds filters to the provided query based on the provided `where` object.
 *
 * @param fields - Fields of the `whereObject` argument.
 * @param whereObject - The `where` argument provided by the user.
 * @param q - The SQL query.
 */
function addFilters<T, Q extends QueryBuilder & WhereMixin>(
  fields: string[],
  whereObject: T,
  q: Q
): Q {
  return fields.reduce<Q>((query: Q, fieldName: string) => {
    const fieldValue = whereObject[fieldName as keyof T]
    const filters = makeFilter(fieldValue, fieldName)
    return filters.reduce((query, filter) => {
      return query.where(filter.sql, ...(filter.args ?? []))
    }, query)
  }, q)
}

function makeFilter(
  fieldValue: unknown,
  fieldName: string
): Array<{ sql: string; args?: unknown[] }> {
  if (fieldValue === null) return [{ sql: `${fieldName} IS NULL` }]
  else if (fieldName === 'AND' || fieldName === 'OR' || fieldName === 'NOT') {
    return [makeBooleanFilter(fieldName as 'AND' | 'OR' | 'NOT', fieldValue)]
  } else if (typeof fieldValue === 'object') {
    // an object containing filters is provided
    // e.g. users.findMany({ where: { id: { in: [1, 2, 3] } } })
    const fs = {
      in: z.any().array().optional(),
      not: z.any().optional(),
      notIn: z.any().optional(),
      lt: z.any().optional(),
      lte: z.any().optional(),
      gt: z.any().optional(),
      gte: z.any().optional(),
      startsWith: z.string().optional(),
      endsWith: z.string().optional(),
      contains: z.string().optional(),
    }

    const fsHandlers = {
      in: makeInFilter.bind(null),
      not: makeNotFilter.bind(null),
      notIn: makeNotInFilter.bind(null),
      lt: makeLtFilter.bind(null),
      lte: makeLteFilter.bind(null),
      gt: makeGtFilter.bind(null),
      gte: makeGteFilter.bind(null),
      startsWith: makeStartsWithFilter.bind(null),
      endsWith: makeEndsWithFilter.bind(null),
      contains: makeContainsFilter.bind(null),
    }

    const filterSchema = z
      .object(fs)
      .strict()
      .refine(
        (data) => Object.keys(fs).some((filter) => filter in data),
        'Please provide at least one filter.'
      )
    // TODO: remove this schema check once we support all filters
    //       or remove the unsupported filters from the types and schemas that are generated from the Prisma schema

    const obj = filterSchema.parse(fieldValue)
    const filters: Array<{ sql: string; args?: unknown[] }> = []

    Object.entries(fsHandlers).forEach((entry) => {
      const [filter, handler] = entry
      if (filter in obj) {
        const sql = handler(fieldName, obj[filter as keyof typeof obj])
        filters.push(sql)
      }
    })

    return filters
  }
  // needed because `WHERE field = NULL` is not valid SQL
  else return [{ sql: `${fieldName} = ?`, args: [fieldValue] }]
}

function joinStatements(
  statements: Array<{ sql: string; args?: unknown[] }>,
  connective: 'OR' | 'AND'
): { sql: string; args?: unknown[] } {
  const sql = statements.map((s) => s.sql).join(` ${connective} `)
  const args = statements
    .map((s) => s.args)
    .reduce((a1, a2) => (a1 ?? []).concat(a2 ?? []))
  return { sql, args }
}

function makeBooleanFilter(
  fieldName: 'AND' | 'OR' | 'NOT',
  value: unknown
): { sql: string; args?: unknown[] } {
  const objects = Array.isArray(value) ? value : [value] // the value may be a single object or an array of objects connected by the provided connective (AND, OR, NOT)
  const sqlStmts = objects.map((obj) => {
    // Make the necessary filters for this object:
    //  - a filter for each field of this object
    //  - connect those filters into 1 filter using AND
    const fields = Object.keys(obj)
    const stmts = fields.reduce(
      (stmts: Array<{ sql: string; args?: unknown[] }>, fieldName) => {
        const fieldValue = obj[fieldName as keyof typeof obj]
        const stmts2 = makeFilter(fieldValue, fieldName)
        return stmts.concat(stmts2)
      },
      []
    )
    return joinStatements(stmts, 'AND')
  })

  if (fieldName === 'NOT') {
    // Every statement in `sqlStmts` must be negated
    // and the negated statements must then be connected by a conjunction (i.e. using AND)
    const statements = sqlStmts.map(({ sql, args }) => {
      return {
        sql: sqlStmts.length > 1 ? `(NOT ${sql})` : `NOT ${sql}`, // ternary if to avoid obsolete parentheses
        args: args,
      }
    })
    return joinStatements(statements, 'AND')
  } else {
    // Join all filters in `sqlStmts` using the requested connective (which is 'OR' or 'NOT')
    return joinStatements(sqlStmts, fieldName)
  }
}

function makeInFilter(
  fieldName: string,
  values: unknown[] | undefined
): { sql: string; args?: unknown[] } {
  return { sql: `${fieldName} IN ?`, args: [values] }
}

function makeNotInFilter(
  fieldName: string,
  values: unknown[] | undefined
): { sql: string; args?: unknown[] } {
  return { sql: `${fieldName} NOT IN ?`, args: [values] }
}

function makeNotFilter(
  fieldName: string,
  value: unknown
): { sql: string; args?: unknown[] } {
  if (value === null) {
    // needed because `WHERE field != NULL` is not valid SQL
    return { sql: `${fieldName} IS NOT NULL` }
  } else {
    return { sql: `${fieldName} != ?`, args: [value] }
  }
}

function makeLtFilter(
  fieldName: string,
  value: unknown
): { sql: string; args?: unknown[] } {
  return { sql: `${fieldName} < ?`, args: [value] }
}

function makeLteFilter(
  fieldName: string,
  value: unknown
): { sql: string; args?: unknown[] } {
  return { sql: `${fieldName} <= ?`, args: [value] }
}

function makeGtFilter(
  fieldName: string,
  value: unknown
): { sql: string; args?: unknown[] } {
  return { sql: `${fieldName} > ?`, args: [value] }
}

function makeGteFilter(
  fieldName: string,
  value: unknown
): { sql: string; args?: unknown[] } {
  return { sql: `${fieldName} >= ?`, args: [value] }
}

function makeStartsWithFilter(
  fieldName: string,
  value: unknown
): { sql: string; args?: unknown[] } {
  return { sql: `${fieldName} LIKE ?`, args: [`${value}%`] }
}

function makeEndsWithFilter(
  fieldName: string,
  value: unknown
): { sql: string; args?: unknown[] } {
  return { sql: `${fieldName} LIKE ?`, args: [`%${value}`] }
}

function makeContainsFilter(
  fieldName: string,
  value: unknown
): { sql: string; args?: unknown[] } {
  return { sql: `${fieldName} LIKE ?`, args: [`%${value}%`] }
}

function addOffset(i: AnyFindInput, q: PostgresSelect): PostgresSelect {
  if (typeof i.skip === 'undefined') return q // no offset
  return q.offset(i.skip)
}

function addLimit(i: AnyFindInput, q: PostgresSelect): PostgresSelect {
  if (typeof i.take === 'undefined') return q // no limit
  return q.limit(i.take)
}

function addDistinct(i: AnyFindInput, q: PostgresSelect): PostgresSelect {
  if (typeof i.distinct === 'undefined') return q
  return q.distinct(...i.distinct)
}

/**
 * Returns an array containing the names of the fields that are set to `true`
 *
 * @param obj - A selection object.
 * @returns Array containing the names of the selected fields.
 */
function getSelectedFields(obj: object): string[] {
  return Object.keys(obj).filter((key) => obj[key as keyof object])
}
