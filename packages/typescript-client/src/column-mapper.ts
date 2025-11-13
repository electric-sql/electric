import { Row, Schema } from './types'

/**
 * A bidirectional column mapper that handles transforming column names
 * between database format (e.g., snake_case) and application format (e.g., camelCase).
 */
export interface ColumnMapper<Extensions = never> {
  /**
   * Transform a row from database format to application format (decode).
   * Applied to data received from Electric.
   */
  decode: (row: Row<Extensions>) => Row<Extensions>

  /**
   * Transform column names from application format to database format (encode).
   * Applied to column references in WHERE clauses and other query parameters.
   */
  encode: (columnName: string) => string

  /**
   * Optional reverse mapping for debugging/introspection.
   * Maps application column names to database column names.
   */
  mapping?: Record<string, string>
}

/**
 * Converts a snake_case string to camelCase.
 *
 * @example
 * snakeToCamel('user_id') // 'userId'
 * snakeToCamel('project_id') // 'projectId'
 * snakeToCamel('created_at') // 'createdAt'
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Converts a camelCase string to snake_case.
 *
 * @example
 * camelToSnake('userId') // 'user_id'
 * camelToSnake('projectId') // 'project_id'
 * camelToSnake('createdAt') // 'created_at'
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

/**
 * Creates a column mapper from an explicit mapping of database columns to application columns.
 *
 * @param mapping - Object mapping database column names (keys) to application column names (values)
 * @returns A ColumnMapper that can encode and decode column names bidirectionally
 *
 * @example
 * const mapper = createColumnMapper({
 *   user_id: 'userId',
 *   project_id: 'projectId',
 *   created_at: 'createdAt'
 * })
 *
 * // Use with ShapeStream
 * const stream = new ShapeStream({
 *   url: 'http://localhost:3000/v1/shape',
 *   params: { table: 'todos' },
 *   columnMapper: mapper
 * })
 */
export function createColumnMapper<Extensions = never>(
  mapping: Record<string, string>
): ColumnMapper<Extensions> {
  // Build reverse mapping: app name -> db name
  const reverseMapping: Record<string, string> = {}
  for (const [dbName, appName] of Object.entries(mapping)) {
    reverseMapping[appName] = dbName
  }

  return {
    decode: (row: Row<Extensions>) => {
      const result: Row<Extensions> = {}
      for (const [dbKey, appKey] of Object.entries(mapping)) {
        if (dbKey in row) {
          result[appKey] = row[dbKey]
        }
      }
      // Include any columns not in the mapping
      for (const key of Object.keys(row)) {
        if (!(key in mapping)) {
          result[key] = row[key]
        }
      }
      return result
    },

    encode: (columnName: string) => {
      return reverseMapping[columnName] ?? columnName
    },

    mapping: reverseMapping,
  }
}

/**
 * Encodes column names in a WHERE clause using the provided encoder function.
 * Uses regex to identify column references and replace them.
 *
 * Handles common SQL patterns:
 * - Simple comparisons: columnName = $1
 * - Function calls: LOWER(columnName)
 * - Qualified names: table.columnName
 * - Operators: columnName IS NULL, columnName IN (...)
 *
 * Note: This uses regex-based replacement which works for most common cases
 * but may not handle all complex SQL expressions perfectly. For complex queries,
 * test thoroughly or use database column names directly in WHERE clauses.
 *
 * @internal
 */
export function encodeWhereClause(
  whereClause: string,
  encode: (columnName: string) => string
): string {
  // Pattern explanation:
  // (?<![a-zA-Z0-9_]) - negative lookbehind: not preceded by identifier char
  // ([a-zA-Z_][a-zA-Z0-9_]*) - capture: valid SQL identifier
  // (?![a-zA-Z0-9_]) - negative lookahead: not followed by identifier char
  //
  // This avoids matching:
  // - Parts of longer identifiers
  // - SQL keywords (handled by checking if result differs from input)
  const identifierPattern = /(?<![a-zA-Z0-9_])([a-zA-Z_][a-zA-Z0-9_]*)(?![a-zA-Z0-9_])/g

  // SQL keywords that should not be transformed (common ones)
  const sqlKeywords = new Set([
    `SELECT`,
    `FROM`,
    `WHERE`,
    `AND`,
    `OR`,
    `NOT`,
    `IN`,
    `IS`,
    `NULL`,
    `TRUE`,
    `FALSE`,
    `LIKE`,
    `ILIKE`,
    `BETWEEN`,
    `ASC`,
    `DESC`,
    `LIMIT`,
    `OFFSET`,
    `ORDER`,
    `BY`,
    `GROUP`,
    `HAVING`,
    `DISTINCT`,
    `AS`,
    `ON`,
    `JOIN`,
    `LEFT`,
    `RIGHT`,
    `INNER`,
    `OUTER`,
    `CROSS`,
    `CASE`,
    `WHEN`,
    `THEN`,
    `ELSE`,
    `END`,
    `CAST`,
    `LOWER`,
    `UPPER`,
    `COALESCE`,
    `NULLIF`,
  ])

  return whereClause.replace(identifierPattern, (match) => {
    // Don't transform SQL keywords
    if (sqlKeywords.has(match.toUpperCase())) {
      return match
    }

    // Don't transform parameter placeholders ($1, $2, etc.)
    // This regex won't match them anyway, but being explicit
    if (match.startsWith(`$`)) {
      return match
    }

    // Apply encoding
    const encoded = encode(match)
    return encoded
  })
}

/**
 * Creates a column mapper that automatically converts between snake_case and camelCase.
 * This is the most common use case for column mapping.
 *
 * When a schema is provided, it will only map columns that exist in the schema.
 * Otherwise, it will map any column name it encounters.
 *
 * @param schema - Optional database schema to constrain mapping to known columns
 * @returns A ColumnMapper for snake_case ↔ camelCase conversion
 *
 * @example
 * // Without schema - maps any column
 * const mapper = snakeCamelMapper()
 *
 * // With schema - only maps columns in schema
 * const mapper = snakeCamelMapper(schema)
 *
 * // Use with ShapeStream
 * const stream = new ShapeStream({
 *   url: 'http://localhost:3000/v1/shape',
 *   params: { table: 'todos' },
 *   columnMapper: snakeCamelMapper()
 * })
 */
export function snakeCamelMapper<Extensions = never>(
  schema?: Schema
): ColumnMapper<Extensions> {
  // If schema provided, build explicit mapping
  if (schema) {
    const mapping: Record<string, string> = {}
    for (const dbColumn of Object.keys(schema)) {
      mapping[dbColumn] = snakeToCamel(dbColumn)
    }
    return createColumnMapper(mapping)
  }

  // Otherwise, map dynamically
  return {
    decode: (row: Row<Extensions>) => {
      const result: Row<Extensions> = {}
      for (const [key, value] of Object.entries(row)) {
        result[snakeToCamel(key)] = value
      }
      return result
    },

    encode: (columnName: string) => {
      return camelToSnake(columnName)
    },
  }
}
