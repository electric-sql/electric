import { OPTYPES, OplogColumnChanges, OpType } from './oplog'

// Merge two sets of changes, using the timestamp to arbitrate conflicts
// so that the last write wins.
export const mergeChangesLastWriteWins = (
  first: OplogColumnChanges,
  second: OplogColumnChanges
): OplogColumnChanges => {
  const allKeys = Object.keys(first).concat(Object.keys(second))
  const uniqueKeys = Array.from(new Set(allKeys))

  const initialValue: OplogColumnChanges = {}

  return uniqueKeys.reduce((acc, key) => {
    const firstValue = first[key]
    const secondValue = second[key]

    if (firstValue === undefined && secondValue === undefined) {
      return acc
    }

    if (firstValue === undefined) {
      acc[key] = secondValue
    } else if (secondValue === undefined) {
      acc[key] = firstValue
    } else {
      acc[key] =
        firstValue.timestamp > secondValue.timestamp ? firstValue : secondValue
    }

    return acc
  }, initialValue)
}

// Merge the type of two operations so that add wins.
export const mergeOpTypesAddWins = (first: OpType, second: OpType): OpType => {
  if (first === OPTYPES.delete && second === OPTYPES.delete) {
    return OPTYPES.delete as OpType
  }

  return OPTYPES.upsert as OpType
}
