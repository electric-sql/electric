import { DbNamespace, Tablename } from './types'

export class QualifiedTablename {
  namespace: DbNamespace
  tablename: Tablename

  constructor(namespace: DbNamespace, tablename: Tablename) {
    this.namespace = namespace
    this.tablename = tablename
  }

  isEqual({ namespace, tablename}: QualifiedTablename): boolean {
    return namespace === this.namespace
        && tablename === this.tablename
  }
}

export const hasIntersection = (tablenames: QualifiedTablename[], candidates: QualifiedTablename[]): boolean => {
  const tLen = tablenames.length
  const cLen = candidates.length

  for (let i = 0; i < tLen; ++i) {
    const tablename = tablenames[i]

    for (let j = 0; j < cLen; ++j) {
      const candidate = candidates[j]

      if (tablename.isEqual(candidate)) {
        return true
      }
    }
  }

  return false
}
