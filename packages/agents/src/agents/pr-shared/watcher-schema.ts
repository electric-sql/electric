import { Type, type Static } from '@sinclair/typebox'

export const ManagedPrRow = Type.Object({
  key: Type.String(), // PR number as string
  number: Type.Integer(),
  manager_entity_url: Type.String(),
  state: Type.Union([Type.Literal(`active`), Type.Literal(`completed`)]),
  spawned_at: Type.String(),
})
export type ManagedPrRow = Static<typeof ManagedPrRow>

export const WatcherSchema = {
  managed_prs: {
    schema: ManagedPrRow,
    type: `pr-watcher:managed_pr`,
    primaryKey: `key` as const,
  },
}
