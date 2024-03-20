import {
  OplogColumnChanges,
  Tag,
  OplogEntryChanges,
  ShadowEntryChanges,
  OplogEntry,
  PendingChanges,
  localOperationsToTableChanges,
  remoteOperationsToTableChanges,
  generateTag,
  OPTYPES,
} from './oplog'
import { difference, union } from '../util/sets'
import { RelationsCache, Row } from '../util'

/**
 * Merge server-sent operation with local pending oplog to arrive at the same row state the server is at.
 * @param localOrigin string specifying the local origin
 * @param local local oplog entries
 * @param incomingOrigin string specifying the upstream origin
 * @param incoming incoming oplog entries
 * @returns Changes to be made to the shadow tables
 */
export function mergeEntries(
  localOrigin: string,
  local: OplogEntry[],
  incomingOrigin: string,
  incoming: OplogEntry[],
  relations: RelationsCache
): PendingChanges {
  const localTableChanges = localOperationsToTableChanges(
    local,
    (timestamp: Date) => {
      return generateTag(localOrigin, timestamp)
    },
    relations
  )
  const incomingTableChanges = remoteOperationsToTableChanges(
    incoming,
    relations
  )

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

      let changes: OplogColumnChanges

      if (incomingChanges.optype === 'GONE') {
        changes = localChanges.changes
      } else {
        changes = mergeChangesLastWriteWins(
          localOrigin,
          localChanges.changes,
          incomingOrigin,
          incomingChanges.changes,
          incomingChanges.fullRow
        )
      }

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

function mergeOpTags(
  local: OplogEntryChanges,
  remote: ShadowEntryChanges
): Tag[] {
  // When the server sends a GONE message, it means we need to delete this row from our side as no further
  // updates will come through. Server doesn't keep track of seen tags, however, so we make the GONE operation
  // have a higher priority than anything else.

  // TODO: Does deleting on GONE make sense at all?
  if (remote.optype === 'GONE') return []

  return calculateTags(local.tag, remote.tags, local.clearTags)
}

function calculateTags(tag: Tag | null, tags: Tag[], clear: Tag[]): Tag[] {
  if (tag == null) {
    return difference(tags, clear)
  } else {
    return union([tag], difference(tags, clear))
  }
}
