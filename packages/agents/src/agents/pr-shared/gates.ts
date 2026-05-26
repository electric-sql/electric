import type {
  CheckRow,
  DocPlanRow,
  GatesRow,
  PrMetaRow,
  ReviewThreadRow,
} from './blackboard-schema'

const REQUIRED_HEADINGS = [
  `## Summary`,
  `## Linked issues`,
  `## Test plan`,
] as const

export function checkTemplate(description: string): boolean {
  for (let i = 0; i < REQUIRED_HEADINGS.length; i++) {
    const heading = REQUIRED_HEADINGS[i]!
    const idx = description.indexOf(heading)
    if (idx === -1) return false
    const start = idx + heading.length
    const nextHeading = REQUIRED_HEADINGS.slice(i + 1).reduce<number>(
      (acc, h) => {
        const j = description.indexOf(h, start)
        return j === -1 ? acc : Math.min(acc, j)
      },
      description.length
    )
    const body = description.slice(start, nextHeading).trim()
    if (body.length === 0) return false
  }
  return true
}

export interface EvalGatesInput {
  pr_meta: Pick<PrMetaRow, `description` | `mergeable`>
  checks: Array<Pick<CheckRow, `conclusion`>>
  review_threads: Array<Pick<ReviewThreadRow, `severity` | `status`>>
  doc_plan: Array<Pick<DocPlanRow, `status`>>
}

export function evalGates(
  b: EvalGatesInput
): Omit<GatesRow, `key` | `last_evaluated_at`> {
  const template_ok = checkTemplate(b.pr_meta.description)
  const ci_green = b.checks.every(
    (c) => c.conclusion === `success` || c.conclusion === `skipped`
  )
  const no_conflicts = b.pr_meta.mergeable === true
  const threads_resolved = b.review_threads.every(
    (t) => t.severity !== `must-fix` || t.status !== `open`
  )
  const docs_ok =
    b.doc_plan.length === 0 || b.doc_plan.every((p) => p.status === `done`)
  const ready_to_merge =
    template_ok && ci_green && no_conflicts && threads_resolved && docs_ok
  return {
    template_ok,
    ci_green,
    no_conflicts,
    threads_resolved,
    docs_ok,
    ready_to_merge,
  }
}
