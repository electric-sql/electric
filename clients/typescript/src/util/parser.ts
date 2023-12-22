import { QualifiedTablename } from './tablename'
import { DbNamespace } from './types'

const dangerousKeywords = [
  'add',
  'alter',
  'commit',
  'create',
  'delete',
  'drop',
  'exec',
  'insert',
  'select into',
  'set',
  'truncate',
  'update',
]

const dangerousKeywordsExp = new RegExp(
  dangerousKeywords.map((keyword) => `\\b${keyword}\\b`).join('|'),
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

export const parseTableNames = (
  sqlQuery: string,
  defaultNamespace: DbNamespace = 'main'
): QualifiedTablename[] => {
  // NOTE(msfstef): using an SQLite parser to create an AST and
  // walk down it to find tablenames is a cleaner solution, but
  // there are no up-to-date parser I could find that would not
  // block modern queries (e.g. windowed queries).
  // For the sake of parsing table names, this seems to do the
  // trick, and with enough test coverage it should be fine
  const tableNameExp = /(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_$.]*)/gi
  const tableMatches = []
  let match
  while ((match = tableNameExp.exec(sqlQuery)) !== null) {
    tableMatches.push(match[1])
  }

  const results: QualifiedTablename[] = []
  Array.from(tableMatches)
    .map((tn) => _ensureQualified(tn, defaultNamespace))
    .sort()
    .forEach((value: string) => {
      const [namespace, tablename] = value.split('.')
      results.push(new QualifiedTablename(namespace, tablename))
    })

  return results
}

const _ensureQualified = (
  candidate: string,
  defaultNamespace: DbNamespace = 'main'
): string => {
  if (candidate.includes('.')) {
    return candidate
  }

  return `${defaultNamespace}.${candidate}`
}
