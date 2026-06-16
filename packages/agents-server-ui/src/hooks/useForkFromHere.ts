import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import type { EventPointer } from '@electric-ax/agents-runtime'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime/client'
import type { TimelineRow } from '../lib/comments'
import type { ForkFromHereAction } from '../components/UserMessage'

/**
 * "Fork from here" anchor map. For each completed `runs` row that is
 * followed by a user-message inbox row, the run pointer identifies
 * "fork up to and including this response, drop everything after."
 * Completed runs without a following prompt (usually the current end
 * of the conversation) get no entry, preserving the old "historic
 * prompt" affordance while moving it to the response footer.
 */
export function useForkFromHere({
  rows,
  db,
  entityUrl,
  canFork,
}: {
  rows: Array<TimelineRow>
  db: EntityStreamDBWithActions | null
  entityUrl: string | null
  canFork: boolean
}): Map<string, ForkFromHereAction> | undefined {
  const { forkEntity } = useElectricAgents()
  const navigate = useNavigate()
  return useMemo(() => {
    if (!forkEntity || !entityUrl || !db) return undefined
    const runOffsets = db.collections.runs.__electricRowOffsets
    if (!runOffsets) return undefined
    const map = new Map<string, ForkFromHereAction>()
    let anchor: { rowKey: string; pointer: EventPointer } | null = null
    for (const row of rows) {
      if (row.run && row.run.status === `completed`) {
        const pointer = runOffsets.get(row.run.key)
        anchor = pointer ? { rowKey: row.$key, pointer } : null
      }
      if (row.inbox && anchor) {
        const capturedAnchor = anchor.pointer
        const capturedRunKey = anchor.rowKey
        map.set(
          capturedRunKey,
          canFork
            ? {
                // Return the chain so the trigger can track in-flight state;
                // forkEntity already toasts on failure, so swallow the rejection.
                onFork: () =>
                  forkEntity(entityUrl, { pointer: capturedAnchor })
                    .then((res) =>
                      navigate({
                        to: `/entity/$`,
                        params: { _splat: res.url.replace(/^\//, ``) },
                      })
                    )
                    .catch(() => {}),
              }
            : { disabled: true }
        )
      }
    }
    return map
  }, [rows, canFork, db, forkEntity, entityUrl, navigate])
}
