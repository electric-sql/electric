import { z } from 'zod'

export const CODING_AGENT_SESSION_META_COLLECTION_TYPE = `coding-agent.sessionMeta`
export const CODING_AGENT_RUNS_COLLECTION_TYPE = `coding-agent.runs`
export const CODING_AGENT_EVENTS_COLLECTION_TYPE = `coding-agent.events`
export const CODING_AGENT_LIFECYCLE_COLLECTION_TYPE = `coding-agent.lifecycle`
export const CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE = `coding-agent.nativeJsonl`

export const codingAgentStatusSchema = z.enum([
  `cold`,
  `starting`,
  `idle`,
  `running`,
  `stopping`,
  `error`,
  `destroyed`,
])
export type CodingAgentStatus = z.infer<typeof codingAgentStatusSchema>

export const sessionMetaRowSchema = z.object({
  key: z.literal(`current`),
  status: codingAgentStatusSchema,
  kind: z.enum([`claude`]),
  target: z.enum([`sandbox`, `host`]),
  pinned: z.boolean(),
  workspaceIdentity: z.string(),
  workspaceSpec: z.discriminatedUnion(`type`, [
    z.object({
      type: z.literal(`volume`),
      name: z.string(),
    }),
    z.object({
      type: z.literal(`bindMount`),
      hostPath: z.string(),
    }),
  ]),
  idleTimeoutMs: z.number(),
  keepWarm: z.boolean(),
  instanceId: z.string().optional(),
  lastError: z.string().optional(),
  currentPromptInboxKey: z.string().optional(),
  lastInboxKey: z.string().optional(),
  nativeSessionId: z.string().optional(),
})
export type SessionMetaRow = z.infer<typeof sessionMetaRowSchema>

export const runRowSchema = z.object({
  key: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  status: z.enum([`running`, `completed`, `failed`]),
  finishReason: z.string().optional(),
  promptInboxKey: z.string(),
  responseText: z.string().optional(),
})
export type RunRow = z.infer<typeof runRowSchema>

export const eventRowSchema = z.object({
  key: z.string(),
  runId: z.string(),
  seq: z.number(),
  ts: z.number(),
  type: z.string(),
  payload: z.looseObject({}),
})
export type EventRow = z.infer<typeof eventRowSchema>

export const lifecycleRowSchema = z.object({
  key: z.string(),
  ts: z.number(),
  event: z.enum([
    `sandbox.starting`,
    `sandbox.started`,
    `sandbox.stopped`,
    `sandbox.failed`,
    `pin`,
    `release`,
    `orphan.detected`,
    `resume.restored`,
    `import.restored`,
    `import.failed`,
  ]),
  detail: z.string().optional(),
})
export type LifecycleRow = z.infer<typeof lifecycleRowSchema>

// ─── nativeJsonl — NEW in Slice B ────────────────────────────────────────────
// Single-row transcript blob. Holds the contents of claude's on-disk
// transcript at ~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl,
// captured after each successful turn. Used to materialise the file
// back into a fresh sandbox so `claude --resume <id>` can find it.
//
// claude's stream-json STDOUT format is different from this on-disk
// transcript — we cannot reconstruct the transcript from stdout, so we
// read the file directly post-turn via `docker exec cat`.
export const nativeJsonlRowSchema = z.object({
  key: z.literal(`current`),
  nativeSessionId: z.string(),
  content: z.string(),
})
export type NativeJsonlRow = z.infer<typeof nativeJsonlRowSchema>
