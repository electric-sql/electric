import {
  OplogColumnChanges,
  Tag,
  OplogEntryChanges,
  ShadowEntryChanges,
  OplogEntry,
  ShadowTableChanges,
  localOperationsToTableChanges,
  remoteOperationsToTableChanges,
  generateTag,
  OPTYPES,
} from './oplog'
import { difference, union } from '../util/sets'
import { Row } from '../util'

/**
 * Merge server-sent operation with local pending oplog to arrive at the same row state the server is at.
 * @param local_origin string specifying the local origin
 * @param local local oplog entries
 * @param incoming_origin string specifying the upstream origin
 * @param incoming incoming oplog entries
 * @returns Changes to be made to the shadow tables
 */
export function mergeEntries(
  local_origin: string,
  local: OplogEntry[],
  incoming_origin: string,
  incoming: OplogEntry[]
): ShadowTableChanges {
  const localTableChanges = localOperationsToTableChanges(
    local,
    (timestamp: Date) => {
      return generateTag(local_origin, timestamp)
    }
  )
  const incomingTableChanges = remoteOperationsToTableChanges(incoming)

  for (const [tablename, incomingMapping] of Object.entries(
    incomingTableChanges
  )) {
    const localMapping = localTableChanges[tablename]

    if (localMapping === undefined) {
      continue
    }

    for (const [primaryKey, incomingChanges] of Object.entries(
      incomingMapping
    )) {
      const localInfo = localMapping[primaryKey]
      if (localInfo === undefined) {
        continue
      }
      const [_, localChanges] = localInfo

      const changes = mergeChangesLastWriteWins(
        local_origin,
        localChanges.changes,
        incoming_origin,
        incomingChanges.changes,
        incomingChanges.fullRow
      )
      let optype

      const tags = mergeOpTags(localChanges, incomingChanges)
      if (tags.length == 0) {
        optype = OPTYPES.delete
      } else {
        optype = OPTYPES.upsert
      }

      Object.assign(incomingChanges, { changes, optype, tags })
    }
  }

  return incomingTableChanges
}

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
