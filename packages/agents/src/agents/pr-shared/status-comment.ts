import type {
  AgentStateRow,
  CommitRow,
  GatesRow,
  PrMetaRow,
} from './blackboard-schema'

export interface RenderStatusInput {
  pr_meta: Pick<PrMetaRow, `number`>
  gates: Pick<
    GatesRow,
    | `template_ok`
    | `ci_green`
    | `no_conflicts`
    | `threads_resolved`
    | `docs_ok`
    | `ready_to_merge`
  >
  agent_state: ReadonlyArray<
    Pick<
      AgentStateRow,
      `role` | `iterations` | `cap` | `paused` | `pause_reason`
    >
  >
  commits: ReadonlyArray<
    Pick<CommitRow, `sha` | `author_agent` | `message` | `ts`>
  >
  pendingChecks: number
  failingChecks: number
  openMustFix: number
}

const STATUS_TRAILER = `<!-- agent-managed-status -->`

function tick(b: boolean): string {
  return b ? `✅` : `🔴`
}

function ago(now: Date, iso: string): string {
  const diffSec = Math.max(
    0,
    Math.floor((now.getTime() - new Date(iso).getTime()) / 1000)
  )
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

export function renderStatusComment(
  input: RenderStatusInput,
  now: Date = new Date()
): string {
  const { gates, pendingChecks, failingChecks, openMustFix } = input
  const ciCell = gates.ci_green
    ? `✅`
    : failingChecks > 0
      ? `🔴 ${failingChecks} failing`
      : `⏳ pending (${pendingChecks} checks running)`
  const conflictsCell = gates.no_conflicts ? `✅` : `🔴 (rebase needed)`
  const threadsCell = gates.threads_resolved
    ? `✅`
    : `🔴 ${openMustFix} open must-fix`
  const docsCell = gates.docs_ok ? `✅` : `🔴 needed`
  const templateCell = gates.template_ok
    ? `✅`
    : `🔴 (missing required headings)`

  const activeRows = input.agent_state
    .map(
      (s) =>
        `- ${s.paused ? `🔴 paused` : `✅`} ${s.role} (${s.iterations}/${s.cap} cycles)`
    )
    .join(`\n`)

  const paused = input.agent_state.filter((s) => s.paused)
  const pausedSection =
    paused.length === 0
      ? `_None_`
      : paused
          .map(
            (s) =>
              `- **${s.role}** — ${s.pause_reason ?? `paused`}. Reply \`/continue ${s.role}\` to resume.`
          )
          .join(`\n`)

  const commitsSection =
    input.commits.length === 0
      ? `_No agent commits yet._`
      : input.commits
          .slice(-5)
          .map(
            (c) =>
              `- \`${c.sha.slice(0, 7)}\` \`${c.message.split(`\n`)[0]}\` — ${ago(now, c.ts)}`
          )
          .join(`\n`)

  return [
    `## 🤖 Agent status — PR #${input.pr_meta.number}`,
    ``,
    `| Gate               | State                                                 |`,
    `| ------------------ | ----------------------------------------------------- |`,
    `| Template           | ${templateCell} |`,
    `| CI                 | ${ciCell} |`,
    `| Conflicts          | ${conflictsCell} |`,
    `| Review threads     | ${threadsCell} |`,
    `| Docs               | ${docsCell} |`,
    `| **Ready to merge** | ${tick(gates.ready_to_merge)} |`,
    ``,
    `### Active agents`,
    ``,
    activeRows,
    ``,
    `### Paused agents`,
    ``,
    pausedSection,
    ``,
    `### Recent agent commits`,
    ``,
    commitsSection,
    ``,
    `---`,
    ``,
    `_Disable agents on this PR with \`/stop\` or by removing the \`agents\` label._`,
    ``,
    STATUS_TRAILER,
  ].join(`\n`)
}

export const STATUS_COMMENT_TRAILER = STATUS_TRAILER
