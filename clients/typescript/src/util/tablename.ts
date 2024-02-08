import { DbNamespace, Tablename } from './types'

export class QualifiedTablename {
  namespace: DbNamespace
  tablename: Tablename

  constructor(namespace: DbNamespace, tablename: Tablename) {
    this.namespace = namespace
    this.tablename = tablename
  }

  isEqual({ namespace, tablename }: QualifiedTablename): boolean {
    return namespace === this.namespace && tablename === this.tablename
  }

  toString(): string {
    // Don't collapse it to "<namespace>.<tablename>" because that can lead to clashes
    // since both `QualifiedTablename("foo", "bar.baz")` and `QualifiedTablename("foo.bar", "baz")`
    // would be collapsed to "foo.bar.baz".
    return JSON.stringify({
      namespace: this.namespace,
      tablename: this.tablename,
    })
  }

  static parse(json: string): QualifiedTablename {
    try {
      const { namespace, tablename } = JSON.parse(json)
      return new QualifiedTablename(namespace, tablename)
    } catch (_e) {
      throw new Error(
        'Could not parse string into a qualified table name: ' + json
      )
    }
  }
}

export const hasIntersection = (
  tablenames: QualifiedTablename[],
  candidates: QualifiedTablename[]
): boolean => {
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
