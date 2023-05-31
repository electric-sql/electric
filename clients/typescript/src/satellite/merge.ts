import {
  OplogColumnChanges,
  Tag,
  OplogEntryChanges,
  ShadowEntryChanges,
} from './oplog'
import { difference, union } from '../util/sets'
import { Row } from '../util'

/**
 * Merge two sets of changes, using the timestamp to arbitrate conflicts
 * so that the last write wins.
 *
 * @remarks
 *
 * The `fullRow` is mutated to reflect the outcome of LWW.
 * For columns that have no changes in `second` we assign the
 * column value from `first`.
 *
 * @param firstOrigin - Origin of the first changes
 * @param first - Changes
 * @param secondOrigin - Origin of the second changes
 * @param second - Changes
 * @param fullRow - The complete row after changes in `second`
 * @returns The merged changes
 */
export const mergeChangesLastWriteWins = (
  firstOrigin: string,
  first: OplogColumnChanges,
  secondOrigin: string,
  second: OplogColumnChanges,
  fullRow: Row
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
      if (firstValue.timestamp === secondValue.timestamp) {
        // origin lexicographic ordered on timestamp equality
        acc[key] = firstOrigin > secondOrigin ? firstValue : secondValue
      } else {
        acc[key] =
          firstValue.timestamp > secondValue.timestamp
            ? firstValue
            : secondValue
      }
    }

    // update value of this key in the full row with the value picked by LWW
    // if the value was modified in `first` but not in `second`
    // acc[key] will contain the value of that column in `first`
    fullRow[key] = acc[key].value

    return acc
  }, initialValue)
}

export const mergeOpTags = (
  local: OplogEntryChanges,
  remote: ShadowEntryChanges
): Tag[] => {
  return calculateTags(local.tag, remote.tags, local.clearTags)
}

const calculateTags = (tag: Tag | null, tags: Tag[], clear: Tag[]) => {
  if (tag == null) {
    return difference(tags, clear)
  } else {
    return union([tag], difference(tags, clear))
  }
}
