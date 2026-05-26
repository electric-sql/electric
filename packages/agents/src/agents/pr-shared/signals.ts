import { nanoid } from 'nanoid'
import type { SignalRow } from './blackboard-schema'

export const SIGNAL_TYPES = [
  `pr_synced`,
  `head_sha_changed`,
  `ci_failed`,
  `ci_passed`,
  `new_human_comment`,
  `review_complete`,
  `review_skipped`,
  `commits_pushed`,
  `base_advanced`,
  `label_changed`,
  `agents_label_removed`,
  `agents_label_restored`,
  `pr_closed`,
  `human_input_required`,
  `continue_granted`,
  `agents_disabled`,
  `gate_state_changed`,
  `ready_to_merge`,
] as const
export type SignalType = (typeof SIGNAL_TYPES)[number]

export interface SignalPayloads {
  pr_synced: Record<string, never>
  head_sha_changed: { from_sha: string; to_sha: string; author_login: string }
  ci_failed: { head_sha: string; failed_checks: string[] }
  ci_passed: Record<string, never>
  new_human_comment: {
    comment_id: string
    author_login: string
    body: string
    file?: string
    line?: number
  }
  review_complete: Record<string, never>
  review_skipped: Record<string, never>
  commits_pushed: {
    shas: string[]
    by_role: `reviewer` | `build-doctor` | `doc-editor`
  }
  base_advanced: Record<string, never>
  label_changed: Record<string, never>
  agents_label_removed: Record<string, never>
  agents_label_restored: Record<string, never>
  pr_closed: Record<string, never>
  human_input_required: { role: string; reason: string; summary: string }
  continue_granted: { role: `reviewer` | `build-doctor` | `doc-editor` | `all` }
  agents_disabled: Record<string, never>
  gate_state_changed: Record<string, never>
  ready_to_merge: Record<string, never>
}

interface SignalsCollection {
  insert: (row: SignalRow) => void
  update: (key: string, mutate: (draft: SignalRow) => void) => void
}

export function insertSignal<T extends SignalType>(
  signals: SignalsCollection,
  type: T,
  payload: SignalPayloads[T]
): void {
  signals.insert({
    key: nanoid(),
    type,
    payload: payload as Record<string, unknown>,
    ts: new Date().toISOString(),
    consumed_by: [],
  })
}

export function isConsumed(row: SignalRow, role: string): boolean {
  return row.consumed_by.includes(role)
}

export function markConsumed(
  signals: SignalsCollection,
  key: string,
  role: string
): void {
  signals.update(key, (draft) => {
    if (!draft.consumed_by.includes(role)) draft.consumed_by.push(role)
  })
}
