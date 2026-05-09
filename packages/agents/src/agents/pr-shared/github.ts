import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CheckRow } from './blackboard-schema'

const execFileP = promisify(execFile)

export interface GhRunner {
  (
    cmd: string,
    args: string[],
    opts: Record<string, unknown>
  ): Promise<{ stdout: string }>
}

const defaultRunner: GhRunner = async (cmd, args, opts) => {
  const { stdout } = await execFileP(
    cmd,
    args,
    opts as Parameters<typeof execFileP>[2]
  )
  return { stdout }
}

export interface GithubPr {
  number: number
  title: string
  state: `open` | `closed`
  merged?: boolean
  mergeable: boolean | null
  head: { sha: string; ref: string }
  base: { sha: string; ref: string }
  body: string
  labels: string[]
}

export interface GithubComment {
  id: string
  user: { login: string }
  body: string
  created_at: string
  path?: string
  line?: number
}

export function createGithubClient(opts: { run?: GhRunner } = {}) {
  const run = opts.run ?? defaultRunner

  async function ghJson<T>(pathArg: string): Promise<T> {
    const { stdout } = await run(`gh`, [`api`, pathArg], {})
    return JSON.parse(stdout) as T
  }

  return {
    async fetchPr(repo: string, number: number): Promise<GithubPr> {
      const raw = await ghJson<{
        number: number
        title: string
        state: `open` | `closed`
        merged?: boolean
        mergeable: boolean | null
        head: { sha: string; ref: string }
        base: { sha: string; ref: string }
        body: string
        labels: Array<{ name: string }>
      }>(`repos/${repo}/pulls/${number}`)
      return { ...raw, labels: raw.labels.map((l) => l.name) }
    },

    async fetchChecks(repo: string, sha: string): Promise<CheckRow[]> {
      const raw = await ghJson<{
        check_runs: Array<{
          name: string
          status: string
          conclusion: string | null
          html_url: string
        }>
      }>(`repos/${repo}/commits/${sha}/check-runs`)
      return raw.check_runs.map((c) => ({
        key: `${c.name}@${sha}`,
        name: c.name,
        status: c.status as CheckRow[`status`],
        conclusion: c.conclusion as CheckRow[`conclusion`],
        log_url: c.html_url,
        head_sha: sha,
      }))
    },

    async fetchCommentsSince(
      repo: string,
      number: number,
      sinceIso: string
    ): Promise<GithubComment[]> {
      return ghJson<GithubComment[]>(
        `repos/${repo}/issues/${number}/comments?since=${sinceIso}`
      )
    },

    async addLabel(repo: string, number: number, label: string): Promise<void> {
      await run(
        `gh`,
        [
          `api`,
          `--method`,
          `POST`,
          `repos/${repo}/issues/${number}/labels`,
          `-f`,
          `labels[]=${label}`,
        ],
        {}
      )
    },

    async removeLabel(
      repo: string,
      number: number,
      label: string
    ): Promise<void> {
      await run(
        `gh`,
        [
          `api`,
          `--method`,
          `DELETE`,
          `repos/${repo}/issues/${number}/labels/${label}`,
        ],
        {}
      )
    },

    async upsertComment(
      repo: string,
      number: number,
      body: string,
      existingId: string | null
    ): Promise<string> {
      if (existingId) {
        await run(
          `gh`,
          [
            `api`,
            `--method`,
            `PATCH`,
            `repos/${repo}/issues/comments/${existingId}`,
            `-f`,
            `body=${body}`,
          ],
          {}
        )
        return existingId
      }
      const { stdout } = await run(
        `gh`,
        [
          `api`,
          `--method`,
          `POST`,
          `repos/${repo}/issues/${number}/comments`,
          `-f`,
          `body=${body}`,
        ],
        {}
      )
      return (JSON.parse(stdout) as { id: number }).id.toString()
    },
  }
}
