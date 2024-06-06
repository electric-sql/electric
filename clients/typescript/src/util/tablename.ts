import { QualifiedTablename } from '@electric-sql/drivers/util'
export * from '@electric-sql/drivers/util'

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