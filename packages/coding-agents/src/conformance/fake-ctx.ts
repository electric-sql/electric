// Extracted from test/integration/slice-a.test.ts so Layer 2 conformance
// scenarios can construct a synthetic ctx without depending on the test
// file. Not exported from the package's public conformance entry — it's
// a private dependency of the integration scenarios.

export interface CollectionStub {
  rows: Map<string, any>
  get(k: string): any
  toArray: Array<any>
}

export function makeCollection(): CollectionStub {
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

export interface FakeCtxState {
  sessionMeta: CollectionStub
  runs: CollectionStub
  events: CollectionStub
  lifecycle: CollectionStub
  nativeJsonl: CollectionStub
  inbox: CollectionStub
}

export interface FakeCtx {
  ctx: any
  state: FakeCtxState
}

export function makeFakeCtx(
  entityUrl: string,
  args: Record<string, unknown>
): FakeCtx {
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

export function pushInbox(
  state: FakeCtxState,
  key: string,
  message_type: string,
  payload: any = {}
): void {
  state.inbox.rows.set(key, { key, message_type, payload })
}
