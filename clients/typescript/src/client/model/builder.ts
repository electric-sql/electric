import * as z from 'zod'
import { isFilterObject } from '../conversions/input'
import { escDoubleQ } from '../../util'

export function makeFilter(
  fieldValue: unknown,
  fieldName: string,
  prefixFieldsWith = ''
): Array<{ sql: string; args?: unknown[] }> {
  if (fieldValue === null)
    return [{ sql: `${prefixFieldsWith}${quoteIdentifier(fieldName)} IS NULL` }]
  else if (fieldName === 'AND' || fieldName === 'OR' || fieldName === 'NOT') {
    return [
      makeBooleanFilter(
        fieldName as 'AND' | 'OR' | 'NOT',
        fieldValue,
        prefixFieldsWith
      ),
    ]
  } else if (isFilterObject(fieldValue)) {
    // an object containing filters is provided
    // e.g. users.findMany({ where: { id: { in: [1, 2, 3] } } })
    const fs = {
      equals: z.any(),
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
      equals: makeEqualsFilter.bind(null),
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
        const sql = handler(
          prefixFieldsWith + quoteIdentifier(fieldName),
          obj[filter as keyof typeof obj]
        )
        filters.push(sql)
      }
    })

    return filters
  }
  // needed because `WHERE field = NULL` is not valid SQL
  else
    return [
      {
        sql: `${prefixFieldsWith}${quoteIdentifier(fieldName)} = ?`,
        args: [fieldValue],
      },
    ]
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
  value: unknown,
  prefixFieldsWith: string
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
        const stmts2 = makeFilter(fieldValue, fieldName, prefixFieldsWith)
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

function makeEqualsFilter(
  fieldName: string,
  value: unknown | undefined
): { sql: string; args?: unknown[] } {
  return { sql: `${fieldName} = ?`, args: [value] }
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
  if (typeof value !== 'string')
    throw new Error('startsWith filter must be a string')
  return {
    sql: `${fieldName} LIKE ?`,
    args: [`${escapeLike(value)}%`],
  }
}

function makeEndsWithFilter(
  fieldName: string,
  value: unknown
): { sql: string; args?: unknown[] } {
  if (typeof value !== 'string')
    throw new Error('endsWith filter must be a string')
  return {
    sql: `${fieldName} LIKE ?`,
    args: [`%${escapeLike(value)}`],
  }
}

function makeContainsFilter(
  fieldName: string,
  value: unknown
): { sql: string; args?: unknown[] } {
  if (typeof value !== 'string')
    throw new Error('contains filter must be a string')
  return {
    sql: `${fieldName} LIKE ?`,
    args: [`%${escapeLike(value)}%`],
  }
}

function escapeLike(value: string): string {
  return value.replaceAll(/(%|_)/g, '\\$1')
}

/**
 * Quotes the identifier, thereby, escaping any quotes in the identifier.
 */
function quoteIdentifier(identifier: string): string {
  return `"${escDoubleQ(identifier)}"`
}
