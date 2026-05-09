import { describe, expect, it, vi } from 'vitest'
import { createGithubClient } from '../../src/agents/pr-shared/github'

describe(`createGithubClient`, () => {
  it(`fetchPr GETs /repos/{owner}/{repo}/pulls/{n} and returns parsed JSON`, async () => {
    const run = vi
      .fn()
      .mockResolvedValue({
        stdout: JSON.stringify({
          number: 42,
          title: `t`,
          state: `open`,
          mergeable: true,
          head: { sha: `h`, ref: `feat` },
          base: { sha: `b`, ref: `main` },
          body: ``,
          labels: [{ name: `agents` }],
        }),
      })
    const gh = createGithubClient({ run })
    const pr = await gh.fetchPr(`foo/bar`, 42)
    expect(pr.number).toBe(42)
    expect(pr.labels).toEqual([`agents`])
    expect(run).toHaveBeenCalledWith(
      `gh`,
      [`api`, `repos/foo/bar/pulls/42`],
      expect.any(Object)
    )
  })

  it(`fetchChecks lists check-runs for a sha`, async () => {
    const run = vi
      .fn()
      .mockResolvedValue({
        stdout: JSON.stringify({
          check_runs: [
            {
              name: `lint`,
              status: `completed`,
              conclusion: `success`,
              html_url: `u`,
            },
          ],
        }),
      })
    const gh = createGithubClient({ run })
    const checks = await gh.fetchChecks(`foo/bar`, `sha1`)
    expect(checks).toEqual([
      {
        key: `lint@sha1`,
        name: `lint`,
        status: `completed`,
        conclusion: `success`,
        log_url: `u`,
        head_sha: `sha1`,
      },
    ])
  })

  it(`fetchCommentsSince includes since query param`, async () => {
    const run = vi.fn().mockResolvedValue({ stdout: `[]` })
    const gh = createGithubClient({ run })
    await gh.fetchCommentsSince(`foo/bar`, 42, `2026-05-09T00:00:00Z`)
    expect(run.mock.calls[0]![1]).toContain(
      `repos/foo/bar/issues/42/comments?since=2026-05-09T00:00:00Z`
    )
  })
})
