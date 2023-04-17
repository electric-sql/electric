import {
  OplogColumnChanges,
  Tag,
  OplogEntryChanges,
  ShadowEntryChanges,
} from './oplog'
import { difference, union } from '../util/sets'

// Merge two sets of changes, using the timestamp to arbitrate conflicts
// so that the last write wins.
export const mergeChangesLastWriteWins = (
  firstOrigin: string,
  first: OplogColumnChanges,
  secondOrigin: string,
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
