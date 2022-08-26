import sqliteParser from 'sqlite-parser'
import { WalkBuilder } from 'walkjs'

const dangerousKeywords = [
  'add',
  'alter',
  'create',
  'delete',
  'drop',
  'exec',
  'insert',
  'select into',
  'set',
  'truncate',
  'update'
]

const dangerousKeywordsExp: RegExp = new RegExp(
  dangerousKeywords.map(keyword => `\\b${keyword}\\b`)
    .join('|'),
  'imu'
)

// XXX ideally this could be schema aware to know about dangerous
// stored functions. But it's not the end of the world if we miss
// some updates as the user can notify manually and the satellite
// still picks up the changes via polling.
//
// XXX it's also possible to implement this per statement using
// https://www.sqlite.org/c3ref/stmt_readonly.html
export const isPotentiallyDangerous = (stmt: string): boolean => {
  return dangerousKeywordsExp.test(stmt)
}

export const parseTableNames = (query: string, defaultNamespace: string) => {
  const ast = sqliteParser(query)
  if (ast.type !== 'statement') { throw 'Invalid SQL statement' }
  if (ast.statement.length !== 1) { throw 'Query must be a single SQL statement.' }

  const statement = ast.statement[0]
  if (statement.type !== 'statement' || statement.variant !== 'select') {
    throw 'Query must be a valid SELECT statement.'
  }

  const results = new Set()

  new WalkBuilder()
    .withSimpleCallback((node) => {
      const result = _ensureNamespaced(node.val.name, defaultNamespace).toLowerCase()

      results.add(result)
    })
    .withGlobalFilter(_isTableIdentifier)
    .walk(statement.from)

  return results
}

const _isTableIdentifier = (node: any) => {
  if (node.nodeType !== 'object') { return false }

  const { val } = node
  if (!val.hasOwnProperty('variant')) { return false }
  if (!val.hasOwnProperty('type')) { return false }

  if (val.type !== 'identifier' || val.variant !== 'table') {
    return false
  }

  return true
}

const _ensureNamespaced = (tableName: string, defaultNamespace: string) => {
  if (tableName.includes('.')) {
    return tableName
  }

  return `${defaultNamespace}.${tableName}`
}
