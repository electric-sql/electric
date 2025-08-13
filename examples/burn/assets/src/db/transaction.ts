import { createTransaction as dbCreateTransaction } from '@tanstack/react-db'
import { ingestMutations } from './mutations'

export function createTransaction() {
  return dbCreateTransaction({ mutationFn: ingestMutations })
}
