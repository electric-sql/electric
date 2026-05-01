import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostProvider } from '../../src/providers/host'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import { LifecycleManager, WorkspaceRegistry, listAdapters } from '../../src'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import { envForKind, loadTestEnv, probeForKind } from '../support/env'

interface CollectionStub {
  rows: Map<string, any>
  get(k: string): any
  toArray: Array<any>
}

function makeCollection(): CollectionStub {
  const rows = new Map<string, any>()
  return {
    rows,
    get(k: string) {
      return rows.get(k)
    },
    get toArray(): Array<any> {
      return Array.from(rows.values())
    },
  }
}

interface FakeCtxState {
  sessionMeta: CollectionStub
  runs: CollectionStub
  events: CollectionStub
  lifecycle: CollectionStub
  nativeJsonl: CollectionStub
  inbox: CollectionStub
}

function makeFakeCtx(entityUrl: string, args: Record<string, unknown>) {
  const state: FakeCtxState = {
    sessionMeta: makeCollection(),
    runs: makeCollection(),
    events: makeCollection(),
    lifecycle: makeCollection(),
    nativeJsonl: makeCollection(),
    inbox: makeCollection(),
  }
  let runCounter = 0
  const ctx: any = {
    entityUrl,
    entityType: `coding-agent`,
    args,
    tags: {},
    firstWake: false,
    db: {
      collections: state,
      actions: {
        sessionMeta_insert: ({ row }: any) =>
          state.sessionMeta.rows.set(row.key, row),
        sessionMeta_update: ({ key, updater }: any) => {
          const r = state.sessionMeta.rows.get(key)
          if (r) updater(r)
        },
        runs_insert: ({ row }: any) => state.runs.rows.set(row.key, row),
        runs_update: ({ key, updater }: any) => {
          const r = state.runs.rows.get(key)
          if (r) updater(r)
        },
        events_insert: ({ row }: any) => state.events.rows.set(row.key, row),
        nativeJsonl_insert: ({ row }: any) =>
          state.nativeJsonl.rows.set(row.key, row),
        lifecycle_insert: ({ row }: any) =>
          state.lifecycle.rows.set(row.key, row),
      },
    },
    recordRun() {
      const key = `run-${++runCounter}`
      const ent: { key: string; status?: string; response: string } = {
        key,
        status: undefined,
        response: ``,
      }
      return {
        key,
        end({ status }: { status: string }) {
          ent.status = status
        },
        attachResponse(text: string) {
          ent.response += text
        },
      }
    },
    setTag: () => Promise.resolve(),
    send: () => undefined,
  }
  return { ctx, state }
}

function pushInbox(
  state: FakeCtxState,
  key: string,
  message_type: string,
  payload: any = {}
) {
  state.inbox.rows.set(key, { key, message_type, payload })
}

const SHOULD_RUN = process.env.HOST_PROVIDER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

describeMaybe(`HostProvider integration`, () => {
  for (const adapter of listAdapters()) {
    const kind = adapter.kind
    const env = loadTestEnv()
    const kindEnv = envForKind(env, kind)
    const describeKind = kindEnv ? describe : describe.skip

    describeKind(`host — ${kind}`, () => {
      it(`runs a one-turn ${kind} prompt on the host with a bind-mount workspace`, async () => {
        const ws = await mkdtemp(join(tmpdir(), `host-int-${kind}-`))
        const provider = new HostProvider()
        const bridge = new StdioBridge()
        const agentId = `/test/coding-agent/host-int-${kind}-${Date.now().toString(36)}`
        try {
          const sandbox = await provider.start({
            agentId,
            kind,
            target: `host`,
            workspace: { type: `bindMount`, hostPath: ws },
            env: kindEnv!,
          })
          const events: any[] = []
          const probe = probeForKind(env, kind)
          const result = await bridge.runTurn({
            sandbox,
            kind,
            prompt: probe.prompt,
            model: probe.model,
            onEvent: (e) => events.push(e),
          })
          expect(result.exitCode).toBe(0)
          expect(result.nativeSessionId).toBeTruthy()
          const assistant = events.find((e) => e.type === `assistant_message`)
          expect(assistant).toBeDefined()
        } finally {
          await provider.destroy(agentId)
          await rm(ws, { recursive: true, force: true })
        }
      }, 120_000)
    })

    describeKind(`host — ${kind} — resume`, () => {
      it(`runs two turns; second turn's materialise uses host home`, async () => {
        // Regression: handler.ts hardcoded /home/agent for transcript
        // materialise. On macOS hosts that path doesn't exist and the
        // mkdir failed with EROFS, pinning the agent to status=error.
        // Two turns exercise the cold-boot resume path: the second turn
        // calls ensureTranscriptMaterialised against the host's home dir.
        if (kind !== `claude`) return // codex resume probe is non-deterministic
        const ws = await mkdtemp(join(tmpdir(), `host-resume-${kind}-`))
        const provider = new HostProvider()
        const bridge = new StdioBridge()
        const wr = new WorkspaceRegistry()
        const lm = new LifecycleManager({
          providers: { sandbox: provider, host: provider },
          bridge,
        })
        const handler = makeCodingAgentHandler(lm, wr, {
          defaults: {
            idleTimeoutMs: 60_000,
            coldBootBudgetMs: 60_000,
            runTimeoutMs: 120_000,
          },
          env: (_kind) => kindEnv!,
        })

        const agentId = `/test/coding-agent/host-resume-${kind}-${Date.now().toString(36)}`
        const probe = probeForKind(env, kind)
        const args = {
          kind,
          target: `host`,
          workspaceType: `bindMount`,
          workspaceHostPath: ws,
          idleTimeoutMs: 60_000,
        }
        const { ctx, state } = makeFakeCtx(agentId, args)

        try {
          // First-wake init
          await handler(ctx, { type: `message_received` })
          expect(state.sessionMeta.get(`current`).status).toBe(`cold`)

          // Turn 1: cold boot, runs prompt, captures transcript
          pushInbox(state, `i1`, `prompt`, { text: probe.prompt })
          await handler(ctx, { type: `message_received` })
          const meta1 = state.sessionMeta.get(`current`)
          expect(meta1.status).toBe(`idle`)
          expect(meta1.lastError).toBeUndefined()
          const runs1 = Array.from(state.runs.rows.values()) as any[]
          expect(runs1).toHaveLength(1)
          expect(runs1[0].status).toBe(`completed`)

          // Turn 2: warm path; ensureTranscriptMaterialised would mkdir
          // /home/agent/.claude/... and fail before the fix. With the
          // fix it writes under os.homedir() (where the file already
          // exists, so probe returns 0 and no write happens).
          pushInbox(state, `i2`, `prompt`, { text: probe.prompt })
          await handler(ctx, { type: `message_received` })
          const meta2 = state.sessionMeta.get(`current`)
          expect(meta2.status).toBe(`idle`)
          expect(meta2.lastError).toBeUndefined()
          const runs2 = Array.from(state.runs.rows.values()) as any[]
          expect(runs2.length).toBeGreaterThanOrEqual(2)
          expect(runs2[runs2.length - 1].status).toBe(`completed`)
        } finally {
          await provider.destroy(agentId).catch(() => undefined)
          await rm(ws, { recursive: true, force: true })
        }
      }, 240_000)
    })
  }
})
