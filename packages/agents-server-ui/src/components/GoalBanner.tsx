import { useMemo } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import styles from './GoalBanner.module.css'
import type {
  EntityStreamDBWithActions,
  GoalStatus,
  Manifest,
} from '@electric-ax/agents-runtime/client'

type GoalRow = {
  objective: string
  status: GoalStatus
  tokenBudget: number | null
  tokensUsed: number
}

interface GoalBannerProps {
  db: EntityStreamDBWithActions | null
}

export function GoalBanner({ db }: GoalBannerProps): React.ReactElement | null {
  const { data: manifests = [] } = useLiveQuery(
    (q) => {
      if (!db) return undefined
      return q.from({ manifest: db.collections.manifests })
    },
    [db]
  )
  const goal = useMemo<GoalRow | null>(() => {
    for (const m of manifests as Array<Manifest>) {
      if (m.kind === `goal`) {
        const rawBudget = m.tokenBudget
        return {
          objective: String(m.objective ?? ``),
          status: (m.status ?? `active`) as GoalStatus,
          tokenBudget:
            rawBudget === null
              ? null
              : typeof rawBudget === `number`
                ? rawBudget
                : null,
          tokensUsed: typeof m.tokensUsed === `number` ? m.tokensUsed : 0,
        }
      }
    }
    return null
  }, [manifests])

  if (!goal) return null

  const usageLabel =
    goal.tokenBudget === null
      ? `${formatTokens(goal.tokensUsed)} tokens`
      : `${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)} tokens`
  const fillRatio =
    goal.tokenBudget !== null && goal.tokenBudget > 0
      ? Math.min(1, goal.tokensUsed / goal.tokenBudget)
      : null
  const over = goal.tokenBudget !== null && goal.tokensUsed >= goal.tokenBudget

  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <span className={styles.label}>Goal</span>
      <span className={styles.objective} title={goal.objective}>
        {goal.objective}
      </span>
      {fillRatio !== null && (
        <div
          className={styles.bar}
          aria-label={`${Math.round(fillRatio * 100)}% of budget used`}
        >
          <div
            className={[styles.barFill, over ? styles.barFillOver : ``]
              .filter(Boolean)
              .join(` `)}
            style={{ transform: `scaleX(${fillRatio})` }}
          />
        </div>
      )}
      <span className={styles.usage}>{usageLabel}</span>
      <span className={[styles.status, statusClass(goal.status)].join(` `)}>
        {goal.status.replace(`_`, ` `)}
      </span>
    </div>
  )
}

function statusClass(status: GoalStatus): string {
  switch (status) {
    case `active`:
      return styles.statusActive!
    case `complete`:
      return styles.statusComplete!
    case `blocked`:
      return styles.statusBlocked!
    case `budget_limited`:
      return styles.statusBudgetLimited!
    default:
      return ``
  }
}

function formatTokens(n: number): string {
  if (n < 1_000) return `${n}`
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}m`
}
