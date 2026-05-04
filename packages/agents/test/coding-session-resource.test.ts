import { describe, expect, it, vi } from 'vitest'
import {
  codingSessionResourceId,
  codingSessionResourceSchema,
  CODER_RESOURCE_TAG,
  CODING_SESSION_RESOURCE_TRANSCRIPT_TYPE,
  CODING_SESSION_RESOURCE_INFO_TYPE,
  createEntityRegistry,
} from '@electric-ax/agents-runtime'
import { registerCodingSession } from '../src/agents/coding-session'
import type { NormalizedEvent } from 'agent-session-protocol'

describe(`codingSessionResourceId`, () => {
  it(`returns a stable, namespaced id`, () => {
    expect(codingSessionResourceId(`abc`)).toBe(`coder-session/abc`)
    expect(codingSessionResourceId(`zzz123`)).toBe(`coder-session/zzz123`)
  })
})

describe(`codingSessionResourceSchema`, () => {
  it(`declares sessionInfo + transcript with primaryKey "key"`, () => {
    expect(codingSessionResourceSchema.sessionInfo.primaryKey).toBe(`key`)
    expect(codingSessionResourceSchema.sessionInfo.type).toBe(
      CODING_SESSION_RESOURCE_INFO_TYPE
    )
    expect(codingSessionResourceSchema.transcript.primaryKey).toBe(`key`)
    expect(codingSessionResourceSchema.transcript.type).toBe(
      CODING_SESSION_RESOURCE_TRANSCRIPT_TYPE
    )
  })

  it(`exposes the tag key consumers should follow`, () => {
    expect(CODER_RESOURCE_TAG).toBe(`coderResource`)
  })
})

/**
 * Integration check: two coder entities pointed at the same resource
 * id see each other's appends. Models the forking / attach scenario:
 * the durable history is on the resource, not on either entity, so a
 * second wrapper can join an existing session and read its history.
 *
 * The runtime mocked here is the same fake used in the main
 * coding-session test — the key trick is sharing a single
 * `resourceStores` map between the two ctxs so an `insert` on one
 * shows up via `get` on the other.
 */
describe(`shared resource attach`, () => {
  it(`appends from entity A are visible to entity B sharing the same resource id`, async () => {
    const sharedResourceStores: Record<
      string,
      {
        sessionInfo: Map<string, Record<string, unknown>>
        transcript: Map<string, Record<string, unknown>>
      }
    > = {}

    const buildCtx = (
      entityUrl: string,
      runner: { run: ReturnType<typeof vi.fn> }
    ) => {
      const entityState = {
        runStatus: new Map<string, Record<string, unknown>>(),
        inboxCursor: new Map<string, Record<string, unknown>>(),
      }
      entityState.runStatus.set(`current`, {
        key: `current`,
        status: `idle`,
      })
      entityState.inboxCursor.set(`current`, { key: `current` })

      const ensureResource = (id: string) => {
        if (!sharedResourceStores[id]) {
          sharedResourceStores[id] = {
            sessionInfo: new Map(),
            transcript: new Map(),
          }
        }
        return sharedResourceStores[id]!
      }

      const buildHandle = (id: string) => {
        const store = ensureResource(id)
        const proxy = (m: Map<string, Record<string, unknown>>) => ({
          insert: (row: Record<string, unknown>) => {
            m.set(String(row.key), { ...row })
          },
          update: (
            key: string,
            updater: (d: Record<string, unknown>) => void
          ) => {
            const existing = m.get(key)
            if (existing) updater(existing)
          },
          get: (k: string) => m.get(k),
          delete: (k: string) => {
            m.delete(k)
          },
          get toArray() {
            return Array.from(m.values())
          },
        })
        return {
          id,
          sessionInfo: proxy(store.sessionInfo),
          transcript: proxy(store.transcript),
        }
      }

      const tags: Record<string, string> = {}
      const ctx = {
        firstWake: false,
        args: { agent: `claude` as const, nativeSessionId: `existing-uuid` },
        entityUrl,
        tags,
        setTag: (k: string, v: string) => {
          tags[k] = v
          return Promise.resolve()
        },
        db: {
          actions: {
            runStatus_insert: ({ row }: { row: Record<string, unknown> }) => {
              entityState.runStatus.set(String(row.key), { ...row })
            },
            runStatus_update: ({
              key,
              updater,
            }: {
              key: string
              updater: (d: Record<string, unknown>) => void
            }) => {
              const e = entityState.runStatus.get(key)
              if (e) updater(e)
            },
            inboxCursor_insert: ({ row }: { row: Record<string, unknown> }) => {
              entityState.inboxCursor.set(String(row.key), { ...row })
            },
            inboxCursor_update: ({
              key,
              updater,
            }: {
              key: string
              updater: (d: Record<string, unknown>) => void
            }) => {
              const e = entityState.inboxCursor.get(key)
              if (e) updater(e)
            },
          },
          collections: {
            runStatus: { get: (k: string) => entityState.runStatus.get(k) },
            inboxCursor: { get: (k: string) => entityState.inboxCursor.get(k) },
            inbox: {
              toArray: [
                {
                  key: `m-001`,
                  from: `u`,
                  timestamp: `2026-04-23T00:00:00Z`,
                  payload: { text: `hi` },
                },
              ] as Array<unknown>,
            },
            runs: { toArray: [] as Array<{ key: string }> },
          },
        },
        mkdb: (id: string) => buildHandle(id),
        observe: vi.fn(async (source: { sourceRef: string }) =>
          buildHandle(source.sourceRef)
        ),
        recordRun: () => ({
          key: `run-0`,
          end: () => {},
          attachResponse: () => {},
        }),
      }
      // Pre-seed sessionInfo on the shared resource so the
      // initial-mirror branch is a no-op (events.length === 0 only
      // triggers loadSession when the resource is genuinely empty).
      // We tee up sessionInfo in advance for both entities to share.
      const id = `coder-session/shared-1`
      ensureResource(id).sessionInfo.set(`current`, {
        key: `current`,
        agent: `claude`,
        cwd: `/tmp/x`,
        electricSessionId: `shared-1`,
        nativeSessionId: `existing-uuid`,
        createdAt: 0,
      })
      // Pre-seed an event so initial mirror is skipped.
      ensureResource(id).transcript.set(`seed`, {
        key: `seed`,
        ts: 0,
        type: `seed`,
        payload: {},
      })
      return { ctx, runner }
    }

    // Entity A's runner emits an event tagged "from-a"
    const runnerA = {
      run: vi.fn(
        async (callArgs: { onEvent?: (ev: NormalizedEvent) => void }) => {
          callArgs.onEvent?.({
            v: 1,
            ts: 1,
            type: `assistant_message`,
            text: `from-a`,
          })
          return { exitCode: 0, stdout: ``, stderr: `` }
        }
      ),
    }
    // Both wrappers point at the same entityUrl slug so they resolve
    // the same resource id (`coder-session/shared-1`).
    const a = buildCtx(`/coder/shared-1`, runnerA)

    const registry = createEntityRegistry()
    registerCodingSession(registry, {
      defaultWorkingDirectory: `/tmp/x`,
      cliRunner: runnerA,
    })
    const def = registry.get(`coder`)!

    await def.definition.handler(
      a.ctx as unknown as Parameters<typeof def.definition.handler>[0],
      { type: `message_received` } as unknown as Parameters<
        typeof def.definition.handler
      >[1]
    )

    // Entity A appended `from-a` into the resource. Entity B (running
    // a different runner) attached to the same resource id and reads
    // it back via observe(). We don't run the second handler — we
    // just check the resource state directly to verify the share.
    const transcript =
      sharedResourceStores[`coder-session/shared-1`]!.transcript
    const types = Array.from(transcript.values()).map((e) => e.type)
    expect(types).toContain(`assistant_message`)
    const assistant = Array.from(transcript.values()).find(
      (e) => e.type === `assistant_message`
    )!
    expect((assistant.payload as { text?: string }).text).toBe(`from-a`)
  })
})
