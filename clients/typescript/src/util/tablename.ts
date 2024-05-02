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
    // Escapes double quotes because names can contain double quotes
    // e.g. CREATE TABLE "f""oo" (...) creates a table named f"oo
    return `"${escDoubleQ(this.namespace)}"."${escDoubleQ(this.tablename)}"`
  }

  static parse(fullyQualifiedName: string): QualifiedTablename {
    try {
      // allow only paired double quotes within the quotes
      // identifiers can't be empty
      const [_, namespace, tablename] =
        /^"((?:[^"]|"")+)"\."((?:[^"]|"")+)"$/.exec(fullyQualifiedName)!
      return new QualifiedTablename(
        unescDoubleQ(namespace),
        unescDoubleQ(tablename)
      )
    } catch (_e) {
      throw new Error(
        'Could not parse string into a qualified table name: ' +
          fullyQualifiedName
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

function escDoubleQ(str: string): string {
  return str.replaceAll('"', '""')
}

function unescDoubleQ(str: string): string {
  return str.replaceAll('""', '"')
}
