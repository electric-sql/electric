import { QualifiedTablename } from './tablename.js'
import { DbNamespace } from './types.js'

export const parseTableNames = (
  sqlQuery: string,
  defaultNamespace: DbNamespace = 'main'
): QualifiedTablename[] => {
  // NOTE(msfstef): using an SQLite parser to create an AST and
  // walk down it to find tablenames is a cleaner solution, but
  // there are no up-to-date parsers I could find that would not
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
