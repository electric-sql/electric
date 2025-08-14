import * as api from '../api'

import type { ElectricCollectionUtils } from '@tanstack/electric-db-collection'
import type {
  Collection,
  MutationFn,
  PendingMutation,
  Transaction,
  UtilsRecord,
} from '@tanstack/react-db'

type MutationData = Omit<PendingMutation, 'collection'>

const ONE_HOUR = 60 * 60 * 1_000

function isElectricUtils(utils: UtilsRecord): utils is ElectricCollectionUtils {
  return 'awaitTxId' in utils && typeof (utils as any).awaitTxId === 'function'
}

function patchRelationMetadata(
  result: MutationData,
  collection: Collection
): MutationData {
  // Set the sync metadata from the collection id, because the default
  // implementation looks for a `table` param which we don't use.
  const parts = collection.id.split(':')
  const relation = parts.length === 2 ? parts : ['public', parts[0]]

  result.syncMetadata = { relation }
  return result
}

function buildPayload(tx: Transaction) {
  const mutations = tx.mutations.map((mutation: PendingMutation) => {
    const { collection, ...result } = mutation

    return mutation.type === 'insert'
      ? patchRelationMetadata(result, collection)
      : result
  })

  return { mutations }
}

async function hasSyncedBack(
  tx: Transaction,
  txid: number,
  timeout: number = ONE_HOUR
) {
  const collections = new Set<Collection>(
    tx.mutations.map((mutation) => mutation.collection).filter(Boolean)
  )

  const promises = [...collections].map((collection) => {
    const utils = collection.utils

    if (isElectricUtils(utils)) {
      return utils.awaitTxId(txid, timeout)
    }

    throw new Error(`Unknown collection type`, { cause: { collection } })
  })

  await Promise.all(promises)
}

export const ingestMutations: MutationFn = async ({ transaction }) => {
  // await new Promise((resolve) => window.setTimeout(resolve, 2000))

  const payload = buildPayload(transaction)
  const txid = await api.ingest(payload)

  if (txid === undefined) {
    return
  }

  await hasSyncedBack(transaction, txid)

  // await new Promise((resolve) => window.setTimeout(resolve, 2000))

  return { txid }
}
