export type WorkerRole = `reviewer` | `build-doctor` | `doc-editor`
export type ContinueTarget = WorkerRole | `all`

export type SlashCommand =
  | { kind: `continue`; role: ContinueTarget }
  | { kind: `stop` }
  | { kind: `resume` }

const CONTINUE_RE = /^\/continue\s+(reviewer|build-doctor|doc-editor|all)\s*$/i
const STOP_RE = /^\/stop\s*$/i
const RESUME_RE = /^\/resume\s*$/i

export function parseSlashCommand(body: string): SlashCommand | null {
  const lines = body.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    const m = CONTINUE_RE.exec(line)
    if (m)
      return { kind: `continue`, role: m[1]!.toLowerCase() as ContinueTarget }
    if (STOP_RE.test(line)) return { kind: `stop` }
    if (RESUME_RE.test(line)) return { kind: `resume` }
  }
  return null
}
