import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { queryOnce } from '@durable-streams/state'
import { z } from 'zod'
import { entity, manifestSourceKey } from '../src/index'
import { db } from '../src/observation-sources'
import { runtimeTest } from './runtime-dsl'
import type { RuntimeHistorySummaryEntry } from './runtime-dsl'
import type {
  EntityHandle,
  EntityStreamDB,
  HandlerContext,
  SharedStateHandle,
  StateCollectionProxy,
} from '../src/index'
import type { OutboundBridgeHandle } from '../src/types'

const statusRowSchema = z.object({
  key: z.string(),
  value: z.string(),
})

const noteRowSchema = z.object({
  key: z.string(),
  text: z.string(),
})

const itemRowSchema = z.object({
  key: z.string(),
  value: z.string(),
})

const observedItemRowSchema = z.object({
  key: z.string(),
  value: z.string(),
})

const observedCountRowSchema = z.object({
  key: z.string(),
  count: z.number().int(),
})

const watcherMirrorRowSchema = z.object({
  key: z.string(),
  childUrl: z.string(),
  itemKey: z.string(),
  value: z.string(),
})

const articleRowSchema = z.object({
  key: z.string(),
  title: z.string(),
  content: z.string(),
})

const commentRowSchema = z.object({
  key: z.string(),
  articleKey: z.string(),
  body: z.string(),
})

const childRowSchema = z.object({
  key: z.string(),
  url: z.string(),
  kind: z.string().optional(),
  chunk: z.number().int().optional(),
  stage: z.number().int().optional(),
  articleKey: z.string().nullable().optional(),
  articleTopic: z.string().nullable().optional(),
  articleAuthor: z.string().nullable().optional(),
})

const wikiMetaRowSchema = z.object({
  key: z.literal(`wiki`),
  topic: z.string(),
  specialistCount: z.number().int(),
})

const pipelineStateRowSchema = z.object({
  key: z.string(),
  currentInput: z.string(),
  currentStage: z.number().int(),
})

const childStatusRowSchema = z.object({
  key: z.string(),
  status: z.string(),
})

const reviewRowSchema = z.object({
  key: z.string(),
  reviewer: z.string(),
  score: z.number().int(),
  feedback: z.string(),
})

const argumentRowSchema = z.object({
  key: z.string(),
  side: z.enum([`pro`, `con`]),
  text: z.string(),
  round: z.number().int(),
})

const wikiKnowledgeRowSchema = z.object({
  key: z.string(),
  topic: z.string(),
  content: z.string(),
  author: z.string(),
})

const peerReviewerCatalog = [
  {
    id: `clarity`,
    reviewer: `clarity-reviewer`,
    score: 8,
    feedback: `clear and readable`,
  },
  {
    id: `correctness`,
    reviewer: `correctness-reviewer`,
    score: 9,
    feedback: `technically sound`,
  },
  {
    id: `completeness`,
    reviewer: `completeness-reviewer`,
    score: 7,
    feedback: `missing edge cases`,
  },
] as const

const articleSchema = {
  articles: {
    schema: articleRowSchema,
    type: `shared:article`,
    primaryKey: `key`,
  },
}

const articleCommentSchema = {
  articles: {
    schema: articleRowSchema,
    type: `shared:article`,
    primaryKey: `key`,
  },
  comments: {
    schema: commentRowSchema,
    type: `shared:comment`,
    primaryKey: `key`,
  },
}

const reviewSchema = {
  reviews: {
    schema: reviewRowSchema,
    type: `shared:review`,
    primaryKey: `key`,
  },
}

const debateSchema = {
  arguments: {
    schema: argumentRowSchema,
    type: `shared:argument`,
    primaryKey: `key`,
  },
}

const wikiKnowledgeSchema = {
  articles: {
    schema: wikiKnowledgeRowSchema,
    type: `shared:wiki_article`,
    primaryKey: `key`,
  },
}

const t = runtimeTest()

type NoteRow = {
  key: string
  text: string
}

type ArticleRow = {
  key: string
  title: string
  content: string
}

type CommentRow = {
  key: string
  articleKey: string
  body: string
}

type ObservedItemRow = {
  key: string
  value: string
}

type ObservedCountRow = {
  key: string
  count: number
}

type ObservationNoticeRow = {
  key: string
  text: string
}

type ChildRow = {
  key: string
  url: string
  kind?: string
  chunk?: number
  stage?: number
  articleKey?: string | null
  articleTopic?: string | null
  articleAuthor?: string | null
}

type PipelineStateRow = {
  key: string
  currentInput: string
  currentStage: number
}

type ReviewRow = {
  key: string
  reviewer: string
  score: number
  feedback: string
}

type ArgumentRow = {
  key: string
  side: `pro` | `con`
  text: string
  round: number
}

type WikiKnowledgeRow = {
  key: string
  topic: string
  content: string
  author: string
}

type WikiMetaRow = {
  key: `wiki`
  topic: string
  specialistCount: number
}

function eventValueRecord(
  event: { value?: unknown } | undefined
): Record<string, unknown> | undefined {
  if (!event || typeof event.value !== `object` || event.value === null) {
    return undefined
  }
  return event.value as Record<string, unknown>
}

function entityIdFromUrl(entityUrl: string): string {
  return entityUrl.split(`/`).filter(Boolean).at(-1) ?? `entity`
}

/**
 * Build a StateCollectionProxy from a runtime db handle.
 */
function buildStateProxy<T extends { key: string }>(
  db: EntityStreamDB,
  collectionName: string
): StateCollectionProxy<T> {
  const dbActions = (db as any).actions ?? {}
  return {
    insert: (row: T) => dbActions[`${collectionName}_insert`]?.({ row }),
    update: (key: string, updater: (draft: T) => void) =>
      dbActions[`${collectionName}_update`]?.({ key, updater }),
    delete: (key: string) => dbActions[`${collectionName}_delete`]?.({ key }),
    get: (key: string) =>
      db.collections[collectionName]?.get(key) as T | undefined,
    get toArray() {
      return collectionRows<T>(db.collections[collectionName])
    },
  }
}

async function awaitPersisted(transaction: unknown): Promise<void> {
  const promise = (
    transaction as
      | { isPersisted?: { promise?: Promise<unknown> } }
      | null
      | undefined
  )?.isPersisted?.promise
  if (promise) {
    await promise
  }
}

function collectionRows<T>(
  collection: { toArray?: unknown } | undefined
): Array<T> {
  return (collection?.toArray ?? []) as unknown as Array<T>
}

function sortRowsByCollectionOrder<
  TRow extends { key: string | number },
>(collection: {
  toArray: Array<TRow>
  __electricRowOffsets?: Map<string | number, string>
}): Array<TRow> {
  return [...collection.toArray].sort((left, right) => {
    const leftOffset = collection.__electricRowOffsets?.get(left.key)
    const rightOffset = collection.__electricRowOffsets?.get(right.key)
    if (leftOffset && rightOffset) {
      return leftOffset.localeCompare(rightOffset)
    }
    if (leftOffset) return -1
    if (rightOffset) return 1

    const leftSeq = Reflect.get(left, `_seq`)
    const rightSeq = Reflect.get(right, `_seq`)
    if (typeof leftSeq === `number` && typeof rightSeq === `number`) {
      return leftSeq - rightSeq
    }
    if (typeof leftSeq === `number`) return -1
    if (typeof rightSeq === `number`) return 1
    return String(left.key).localeCompare(String(right.key))
  })
}

function sortSnapshotEntriesByDebateSide(
  entries: Array<RuntimeHistorySummaryEntry>
): Array<RuntimeHistorySummaryEntry> {
  const sideOrder = new Map([
    [`pro`, 0],
    [`con`, 1],
  ])

  return [...entries].sort((left, right) => {
    const leftSide = String(
      eventValueRecord(left as { value?: unknown })?.side ?? ``
    )
    const rightSide = String(
      eventValueRecord(right as { value?: unknown })?.side ?? ``
    )
    const leftRank = sideOrder.get(leftSide) ?? Number.MAX_SAFE_INTEGER
    const rightRank = sideOrder.get(rightSide) ?? Number.MAX_SAFE_INTEGER

    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }

    return String(left.key ?? ``).localeCompare(String(right.key ?? ``))
  })
}

async function readLatestCompletedHandleText(
  handle: Pick<EntityHandle, `text`>
): Promise<string> {
  const runs = await handle.text()
  return runs.at(-1) ?? ``
}

function upsertChildRow(
  children: StateCollectionProxy<ChildRow>,
  row: ChildRow
): void {
  const existing = children.get(row.key)
  if (!existing) {
    children.insert(row)
    return
  }

  children.update(row.key, (draft) => {
    draft.url = row.url
    if (row.kind !== undefined) draft.kind = row.kind
    if (row.chunk !== undefined) draft.chunk = row.chunk
    if (row.stage !== undefined) draft.stage = row.stage
    if (row.articleKey !== undefined) draft.articleKey = row.articleKey
    if (row.articleTopic !== undefined) draft.articleTopic = row.articleTopic
    if (row.articleAuthor !== undefined) {
      draft.articleAuthor = row.articleAuthor
    }
  })
}

function upsertChildStatusRow(
  childStatus: StateCollectionProxy<{ key: string; status: string }>,
  key: string,
  status: string
): void {
  const existing = childStatus.get(key)
  if (!existing) {
    childStatus.insert({ key, status })
    return
  }

  if (existing.status === status) {
    return
  }

  childStatus.update(key, (draft) => {
    draft.status = status
  })
}

type TestResponseFn = (
  message: string,
  bridge: OutboundBridgeHandle
) => Promise<string | undefined>

type TestAgentSpec = {
  model: string
  testResponses: Array<string> | TestResponseFn
}

async function runTestAgent(
  ctx: HandlerContext,
  spec: TestAgentSpec
): Promise<void> {
  ctx.useAgent({
    systemPrompt: `test`,
    model: spec.model,
    tools: [],
    testResponses: spec.testResponses,
  })
  await ctx.agent.run()
}

function createCommandTestAgent(opts: {
  modelId: string
  runCommand: TestResponseFn
}): TestAgentSpec {
  return {
    model: opts.modelId,
    testResponses: async (message, bridge) => {
      return opts.runCommand(message, bridge)
    },
  }
}

function createFakeToolAssistant(opts?: {
  notes?: StateCollectionProxy<NoteRow>
}): TestAgentSpec {
  return {
    model: `fake-tool-assistant`,
    testResponses: async (message, bridge) => {
      const runCommand = async (command: string): Promise<string> => {
        const trimmed = command.trim()

        if (trimmed.startsWith(`sync_echo `)) {
          const text = trimmed.slice(`sync_echo `.length)
          bridge.onToolCallStart(`call-sync_echo`, `sync_echo`, { text })
          const result = { echoed: text }
          bridge.onToolCallEnd(`call-sync_echo`, `sync_echo`, result, false)
          return `sync_echo: ${text}`
        }

        if (trimmed.startsWith(`async_lookup `)) {
          const key = trimmed.slice(`async_lookup `.length)
          bridge.onToolCallStart(`call-async_lookup`, `async_lookup`, { key })
          await new Promise((resolve) => setTimeout(resolve, 5))
          const result = { key, value: `lookup:${key}` }
          bridge.onToolCallEnd(
            `call-async_lookup`,
            `async_lookup`,
            result,
            false
          )
          return `async_lookup: lookup:${key}`
        }

        if (trimmed.startsWith(`stateful_note write `)) {
          const match = trimmed.match(/^stateful_note write (\S+)\s+(.+)$/)
          const key = match?.[1] ?? ``
          const text = match?.[2] ?? ``
          bridge.onToolCallStart(`call-stateful_note`, `stateful_note`, {
            action: `write`,
            key,
            text,
          })
          const existing = key ? opts?.notes?.get(key) : undefined
          if (key) {
            if (existing) {
              opts?.notes?.update(key, (draft) => {
                draft.text = text
              })
            } else {
              opts?.notes?.insert({ key, text })
            }
          }
          bridge.onToolCallEnd(
            `call-stateful_note`,
            `stateful_note`,
            { action: `write`, key, text },
            false
          )
          return `stateful_note write: ${key}=${text}`
        }

        if (trimmed.startsWith(`stateful_note read `)) {
          const key = trimmed.slice(`stateful_note read `.length)
          bridge.onToolCallStart(`call-stateful_note`, `stateful_note`, {
            action: `read`,
            key,
          })
          const text = opts?.notes?.get(key)?.text ?? `<missing>`
          bridge.onToolCallEnd(
            `call-stateful_note`,
            `stateful_note`,
            { action: `read`, key, text },
            false
          )
          return `stateful_note read: ${key}=${text}`
        }

        if (trimmed.startsWith(`fail_tool `)) {
          const reason = trimmed.slice(`fail_tool `.length)
          bridge.onToolCallStart(`call-fail_tool`, `fail_tool`, { reason })
          bridge.onToolCallEnd(
            `call-fail_tool`,
            `fail_tool`,
            `fail_tool: ${reason}`,
            true
          )
          return `fail_tool error: ${reason}`
        }

        return `plain: ${trimmed}`
      }

      const commands = message
        .split(`&&`)
        .map((part) => part.trim())
        .filter(Boolean)

      let response = ``
      for (const command of commands) {
        response = await runCommand(command)
      }

      return response
    },
  }
}

function createSharedStateCrudAssistant(opts: {
  articles: StateCollectionProxy<ArticleRow>
}): TestAgentSpec {
  return {
    model: `shared-state-crud`,
    testResponses: async (message) => {
      const trimmed = message.trim()

      if (trimmed.startsWith(`insert `) || trimmed.startsWith(`update `)) {
        const match = trimmed.match(/^(insert|update)\s+(\S+)\s+(.+)$/)
        const mode = match?.[1] ?? ``
        const key = match?.[2] ?? ``
        const spec = match?.[3] ?? ``
        const [title, content] = spec.split(`|`, 2)

        if (mode === `insert`) {
          opts.articles.insert({
            key,
            title: title ?? ``,
            content: content ?? ``,
          })
          return `inserted:${key}:${title ?? ``}|${content ?? ``}`
        }

        opts.articles.update(key, (draft) => {
          draft.title = title ?? ``
          draft.content = content ?? ``
        })
        return `updated:${key}:${title ?? ``}|${content ?? ``}`
      }

      if (trimmed.startsWith(`delete `)) {
        const key = trimmed.slice(`delete `.length)
        opts.articles.delete(key)
        return `deleted:${key}`
      }

      if (trimmed.startsWith(`read `)) {
        const key = trimmed.slice(`read `.length)
        const row = opts.articles.get(key)
        return row
          ? `read:${key}:${row.title}|${row.content}`
          : `read:${key}:<missing>`
      }

      if (trimmed === `count`) {
        return `count:${opts.articles.toArray.length}`
      }

      return `unknown:${trimmed}`
    },
  }
}

function createLocalItemCrudAssistant(opts: {
  items: StateCollectionProxy<ObservedItemRow>
}): TestAgentSpec {
  return {
    model: `local-item-crud`,
    testResponses: async (message) => {
      const trimmed = message.trim()
      const match = trimmed.match(/^(insert|update)\s+(\S+)\s+(.+)$/)

      if (match) {
        const mode = match[1] ?? ``
        const key = match[2] ?? ``
        const value = match[3] ?? ``

        if (mode === `insert` || !opts.items.get(key)) {
          opts.items.insert({ key, value })
          return `inserted:${key}:${value}`
        }

        opts.items.update(key, (draft) => {
          draft.value = value
        })
        return `updated:${key}:${value}`
      }

      if (trimmed.startsWith(`delete `)) {
        const key = trimmed.slice(`delete `.length)
        opts.items.delete(key)
        return `deleted:${key}`
      }

      return `unknown:${trimmed}`
    },
  }
}

function createDeterministicChildAssistant(config: {
  label: string
  delayMs?: number
}): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `deterministic-child`,
    runCommand: async (message) => {
      let trimmed = message.trim()
      if (config.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, config.delayMs))
      }

      const targetedMatch = trimmed.match(
        /^__(silent|fail)__:([a-z0-9_,-]+)\s+(.+)$/i
      )
      if (targetedMatch) {
        const mode = targetedMatch[1]!.toLowerCase()
        const labels = targetedMatch[2]!
          .split(`,`)
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean)
        const payload = targetedMatch[3]!

        if (labels.includes(config.label.toLowerCase())) {
          if (mode === `silent`) {
            return undefined
          }
          throw new Error(`deterministic failure for ${config.label}`)
        }

        trimmed = payload
      }

      if (trimmed === `__silent__`) {
        return undefined
      }
      return `${config.label}::${trimmed}`
    },
  })
}

function createObservationRelayAssistant(opts: {
  watchChild: (childUrl: string) => Promise<boolean>
  notices: StateCollectionProxy<ObservationNoticeRow>
}): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `observation-relay`,
    runCommand: async (message) => {
      const trimmed = message.trim()

      if (trimmed.startsWith(`watch `)) {
        const childUrl = trimmed.slice(`watch `.length)
        const created = await opts.watchChild(childUrl)
        return created
          ? `watching:${childUrl}:items`
          : `already-watching:${childUrl}:items`
      }

      if (trimmed === `report`) {
        return opts.notices.toArray
          .sort((left, right) => left.key.localeCompare(right.key))
          .map((row) => row.text)
          .join(`|`)
      }

      try {
        const payload = JSON.parse(trimmed) as Record<string, unknown>
        if (payload.type !== `observation_update`) {
          return `plain:${trimmed}`
        }

        const kind = String(payload.kind ?? `unknown`)
        const collection = String(payload.collection ?? `unknown`)
        const event = payload.event as Record<string, unknown> | undefined
        const eventKey = String(event?.key ?? `unknown`)
        const eventValue =
          event && typeof event.value === `object` && event.value !== null
            ? (event.value as Record<string, unknown>)
            : undefined
        const previousValue =
          event &&
          typeof event.previousValue === `object` &&
          event.previousValue !== null
            ? (event.previousValue as Record<string, unknown>)
            : undefined

        let text = `${kind}:${collection}:${eventKey}`
        if (kind === `insert`) {
          text = `${text}:${String(eventValue?.value ?? ``)}`
        } else if (kind === `update`) {
          text = `${text}:${String(previousValue?.value ?? ``)}->${String(
            eventValue?.value ?? ``
          )}`
        } else if (kind === `delete`) {
          text = `${text}:${String(eventValue?.value ?? ``)}`
        }

        const key = `notice-${String(opts.notices.toArray.length + 1).padStart(4, `0`)}`
        opts.notices.insert({ key, text })
        return `noticed:${text}`
      } catch {
        return `plain:${trimmed}`
      }
    },
  })
}

function createMultiCollectionSharedStateAssistant(opts: {
  articles: StateCollectionProxy<ArticleRow>
  comments: StateCollectionProxy<CommentRow>
}): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `shared-state-multi`,
    runCommand: async (message) => {
      const commands = message
        .split(`&&`)
        .map((part) => part.trim())
        .filter(Boolean)

      let response = ``

      for (const command of commands) {
        const trimmed = command.trim()

        if (trimmed.startsWith(`write_article `)) {
          const match = trimmed.match(/^write_article\s+(\S+)\s+(.+)$/)
          const key = match?.[1] ?? ``
          const spec = match?.[2] ?? ``
          const [title, content] = spec.split(`|`, 2)

          if (opts.articles.get(key)) {
            opts.articles.update(key, (draft) => {
              draft.title = title ?? ``
              draft.content = content ?? ``
            })
          } else {
            opts.articles.insert({
              key,
              title: title ?? ``,
              content: content ?? ``,
            })
          }

          response = `article:${key}:${title ?? ``}|${content ?? ``}`
          continue
        }

        if (trimmed.startsWith(`write_comment `)) {
          const match = trimmed.match(/^write_comment\s+(\S+)\s+(\S+)\|(.+)$/)
          const key = match?.[1] ?? ``
          const articleKey = match?.[2] ?? ``
          const body = match?.[3] ?? ``

          if (opts.comments.get(key)) {
            opts.comments.update(key, (draft) => {
              draft.articleKey = articleKey
              draft.body = body
            })
          } else {
            opts.comments.insert({
              key,
              articleKey,
              body,
            })
          }

          response = `comment:${key}:${articleKey}|${body}`
          continue
        }

        if (trimmed === `summary`) {
          const articles = opts.articles.toArray
          const comments = opts.comments.toArray
          response =
            `articles:${articles.length};comments:${comments.length};` +
            articles
              .map((article) => {
                const commentBodies = comments
                  .filter((comment) => comment.articleKey === article.key)
                  .map((comment) => comment.body)
                  .join(`,`)
                return `${article.key}:${article.title}[${commentBodies || `none`}]`
              })
              .join(`;`)
          continue
        }

        response = `unknown:${trimmed}`
      }

      return response
    },
  })
}

function createDispatcherAssistant(ctx: HandlerContext): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `dispatcher`,
    runCommand: async (message, bridge) => {
      const match = message
        .trim()
        .match(/^dispatch\s+(assistant|worker)\s+(.+)$/)
      if (!match) {
        return `unknown:${message.trim()}`
      }

      const targetKind = match[1] as `assistant` | `worker`
      const task = match[2] ?? ``
      const counters = buildStateProxy<{
        key: string
        value: number
      }>(ctx.db, `counters`)
      const children = buildStateProxy<ChildRow>(ctx.db, `children`)
      const status = buildStateProxy<{
        key: string
        value: string
      }>(ctx.db, `status`)
      const parentId = entityIdFromUrl(ctx.entityUrl)
      const countRow = counters.get(`dispatchCount`)
      const dispatchCount = (countRow?.value ?? 0) + 1

      bridge.onToolCallStart(`call-dispatch`, `dispatch`, {
        type: targetKind,
        task,
      })

      if (countRow) {
        counters.update(`dispatchCount`, (draft) => {
          draft.value = dispatchCount
        })
      } else {
        counters.insert({ key: `dispatchCount`, value: dispatchCount })
      }

      status.update(`current`, (draft: Record<string, unknown>) => {
        draft.value = `classifying`
      })
      status.update(`current`, (draft: Record<string, unknown>) => {
        draft.value = `dispatching`
      })

      const childType =
        targetKind === `assistant`
          ? TYPES.f1AssistantChild
          : TYPES.f1WorkerChild
      const childId = `${parentId}-dispatch-${dispatchCount}`
      const child = await ctx.spawn(childType, childId)
      child.send(task)
      children.insert({ key: childId, url: child.entityUrl, kind: targetKind })

      status.update(`current`, (draft: Record<string, unknown>) => {
        draft.value = `waiting`
      })

      const fullText = await readLatestCompletedHandleText(child)

      status.update(`current`, (draft: Record<string, unknown>) => {
        draft.value = `idle`
      })

      bridge.onToolCallEnd(
        `call-dispatch`,
        `dispatch`,
        { type: targetKind, childId },
        false
      )
      return fullText || `(no text output)`
    },
  })
}

function createManagerWorkerAssistant(ctx: HandlerContext): TestAgentSpec {
  const perspectives = [
    { id: `optimist`, delayMs: 10 },
    { id: `pessimist`, delayMs: 25 },
    { id: `pragmatist`, delayMs: 5 },
  ] as const

  return createCommandTestAgent({
    modelId: `manager-worker`,
    runCommand: async (message, bridge) => {
      const trimmed = message.trim()
      const children = buildStateProxy<ChildRow>(ctx.db, `children`)
      const childStatus = buildStateProxy<{
        key: string
        status: string
      }>(ctx.db, `childStatus`)
      const status = buildStateProxy<{
        key: string
        value: string
      }>(ctx.db, `status`)

      if (trimmed.startsWith(`spawn_perspectives `)) {
        const question = trimmed.slice(`spawn_perspectives `.length)
        const parentId = entityIdFromUrl(ctx.entityUrl)
        bridge.onToolCallStart(
          `call-spawn_perspectives`,
          `spawn_perspectives`,
          { question }
        )

        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `spawning`
        })

        for (const perspective of perspectives) {
          const existingChild = children.get(perspective.id)
          const child = existingChild?.url
            ? await ctx.observe(entity(existingChild.url), {
                wake: `runFinished`,
              })
            : await ctx.spawn(
                TYPES.fCoordWorker,
                `${parentId}-${perspective.id}`,
                {
                  label: perspective.id,
                  delayMs: perspective.delayMs,
                }
              )
          child.send(question)
          upsertChildRow(children, {
            key: perspective.id,
            url: child.entityUrl,
            kind: perspective.id,
          })
          upsertChildStatusRow(childStatus, perspective.id, `running`)
          await ctx.observe(entity(child.entityUrl), { wake: `runFinished` })
        }

        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `waiting`
        })

        bridge.onToolCallEnd(
          `call-spawn_perspectives`,
          `spawn_perspectives`,
          { spawned: perspectives.map((perspective) => perspective.id) },
          false
        )
        return `spawned:${perspectives.map((perspective) => perspective.id).join(`,`)}`
      }

      if (trimmed === `wait_for_all`) {
        bridge.onToolCallStart(`call-wait_for_all`, `wait_for_all`, {})

        if (children.toArray.length === 0) {
          bridge.onToolCallEnd(
            `call-wait_for_all`,
            `wait_for_all`,
            { error: true },
            true
          )
          return `No perspective agents have been spawned yet.`
        }

        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `waiting`
        })

        const results: Array<string> = []
        for (const perspective of perspectives) {
          const childRow = children.get(perspective.id)
          if (!childRow?.url) {
            continue
          }
          const child = await ctx.observe(entity(childRow.url))
          const fullText =
            (await readLatestCompletedHandleText(child)) || `(no text output)`
          results.push(`${perspective.id}:${fullText}`)
        }

        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `synthesizing`
        })
        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `idle`
        })

        bridge.onToolCallEnd(
          `call-wait_for_all`,
          `wait_for_all`,
          { collected: results.length },
          false
        )
        return results.join(` | `)
      }

      return `unknown:${trimmed}`
    },
  })
}

function createMapReduceAssistant(ctx: HandlerContext): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `map-reduce`,
    runCommand: async (message, bridge) => {
      const match = message.trim().match(/^map_chunks\s+(.+?)\s*::\s*(.+)$/)
      if (!match) {
        return `unknown:${message.trim()}`
      }

      const task = match[1] ?? ``
      const chunkSpecs = (match[2] ?? ``)
        .split(`|`)
        .map((part) => part.trim())
        .filter(Boolean)
      const children = buildStateProxy<ChildRow>(ctx.db, `children`)
      const status = buildStateProxy<{
        key: string
        value: string
      }>(ctx.db, `status`)
      const parentId = entityIdFromUrl(ctx.entityUrl)

      bridge.onToolCallStart(`call-map_chunks`, `map_chunks`, {
        task,
        chunkCount: chunkSpecs.length,
      })
      status.update(`current`, (draft: Record<string, unknown>) => {
        draft.value = `mapping`
      })

      for (let i = 0; i < chunkSpecs.length; i++) {
        const spec = chunkSpecs[i] ?? ``
        const [chunkText, delayText] = spec.split(`@`, 2)
        const childKey = `chunk-${i + 1}`
        const existingChild = children.get(childKey)
        const child = existingChild?.url
          ? await ctx.observe(entity(existingChild.url))
          : await ctx.spawn(TYPES.fCoordWorker, `${parentId}-${childKey}`, {
              label: childKey,
              delayMs: Number(delayText ?? `0`),
            })
        child.send(`${task}:${chunkText ?? ``}`)
        upsertChildRow(children, {
          key: childKey,
          url: child.entityUrl,
          chunk: i,
        })
      }

      status.update(`current`, (draft: Record<string, unknown>) => {
        draft.value = `reducing`
      })

      const orderedChildren = [...children.toArray].sort(
        (left, right) => (left.chunk ?? 0) - (right.chunk ?? 0)
      )
      const results: Array<string> = []
      for (const childRow of orderedChildren) {
        const child = await ctx.observe(entity(childRow.url))
        results.push(
          (await readLatestCompletedHandleText(child)) || `(no text output)`
        )
      }

      status.update(`current`, (draft: Record<string, unknown>) => {
        draft.value = `idle`
      })
      bridge.onToolCallEnd(
        `call-map_chunks`,
        `map_chunks`,
        { chunkCount: results.length },
        false
      )

      return results
        .map((result, index) => `chunk-${index + 1}:${result}`)
        .join(` | `)
    },
  })
}

function createPipelineAssistant(ctx: HandlerContext): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `pipeline`,
    runCommand: async (message, bridge) => {
      const match = message.trim().match(/^run_pipeline\s+(.+?)\s*::\s*(.+)$/)
      if (!match) {
        return `unknown:${message.trim()}`
      }

      const input = match[1] ?? ``
      const stages = (match[2] ?? ``)
        .split(`|`)
        .map((part) => part.trim())
        .filter(Boolean)
      const children = buildStateProxy<ChildRow>(ctx.db, `children`)
      const status = buildStateProxy<{
        key: string
        value: string
      }>(ctx.db, `status`)
      const pipeline = buildStateProxy<PipelineStateRow>(ctx.db, `pipeline`)
      const parentId = entityIdFromUrl(ctx.entityUrl)

      bridge.onToolCallStart(`call-run_pipeline`, `run_pipeline`, {
        input,
        stageCount: stages.length,
      })

      let currentInput = input

      for (let i = 0; i < stages.length; i++) {
        const stageNumber = i + 1
        await awaitPersisted(
          status.update(`current`, (draft: Record<string, unknown>) => {
            draft.value = `stage_${Math.min(stageNumber, 5)}`
          })
        )
        await awaitPersisted(
          pipeline.update(`state`, (draft) => {
            draft.currentInput = currentInput
            draft.currentStage = i
          })
        )

        const childKey = `${parentId}-stage-${stageNumber}`
        const existingChild = children.get(childKey)
        const child = existingChild?.url
          ? await ctx.observe(entity(existingChild.url))
          : await ctx.spawn(TYPES.fCoordWorker, childKey, {
              label: stages[i] ?? `stage-${stageNumber}`,
            })
        child.send(currentInput)
        upsertChildRow(children, {
          key: childKey,
          url: child.entityUrl,
          stage: stageNumber,
        })

        currentInput =
          (await readLatestCompletedHandleText(child)) ||
          `(stage "${stages[i] ?? `stage-${stageNumber}`}" produced no text output)`
      }

      await awaitPersisted(
        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `done`
        })
      )
      await awaitPersisted(
        pipeline.update(`state`, (draft) => {
          draft.currentInput = currentInput
          draft.currentStage = stages.length
        })
      )

      bridge.onToolCallEnd(
        `call-run_pipeline`,
        `run_pipeline`,
        { stageCount: stages.length },
        false
      )
      return currentInput
    },
  })
}

function createResearchWorkerAssistant(config: {
  subtopic: string
}): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `research-worker`,
    runCommand: async (message) => {
      const topic = message.trim()
      return `research:${config.subtopic}:${topic}`
    },
  })
}

function createResearchAssistant(ctx: HandlerContext): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `deep-researcher`,
    runCommand: async (message, bridge) => {
      const trimmed = message.trim()
      const children = buildStateProxy<ChildRow>(ctx.db, `children`)
      const status = buildStateProxy<{
        key: string
        value: string
      }>(ctx.db, `status`)
      const parentId = entityIdFromUrl(ctx.entityUrl)

      if (trimmed.startsWith(`spawn_researchers `)) {
        const match = trimmed.match(/^spawn_researchers\s+(.+?)\s*::\s*(.+)$/)
        if (!match) {
          return `invalid:spawn_researchers`
        }

        const topic = match[1] ?? ``
        const subtopics = (match[2] ?? ``)
          .split(`|`)
          .map((part) => part.trim())
          .filter(Boolean)

        bridge.onToolCallStart(`call-spawn_researchers`, `spawn_researchers`, {
          topic,
          researcherCount: subtopics.length,
        })
        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `spawning`
        })

        for (const subtopic of subtopics) {
          const childKey = subtopic.toLowerCase().replace(/\s+/g, `-`)
          const existingChild = children.get(childKey)
          const child = existingChild?.url
            ? await ctx.observe(entity(existingChild.url))
            : await ctx.spawn(
                TYPES.m1ResearchWorker,
                `${parentId}-${childKey}`,
                { subtopic },
                { initialMessage: topic }
              )
          if (existingChild?.url) {
            child.send(topic)
          }
          upsertChildRow(children, {
            key: childKey,
            url: child.entityUrl,
            kind: subtopic,
          })
        }

        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `waiting`
        })
        bridge.onToolCallEnd(
          `call-spawn_researchers`,
          `spawn_researchers`,
          { topic, subtopics },
          false
        )
        return `spawned_researchers:${subtopics.join(`,`)}`
      }

      if (trimmed === `wait_for_results`) {
        bridge.onToolCallStart(`call-wait_for_results`, `wait_for_results`, {})

        if (children.toArray.length === 0) {
          bridge.onToolCallEnd(
            `call-wait_for_results`,
            `wait_for_results`,
            { error: true },
            true
          )
          return `No researcher agents have been spawned yet.`
        }

        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `synthesizing`
        })
        const results: Array<string> = []
        const orderedChildren = [...children.toArray].sort((left, right) =>
          String(left.kind ?? left.key).localeCompare(
            String(right.kind ?? right.key)
          )
        )
        for (const childRow of orderedChildren) {
          const child = await ctx.observe(entity(childRow.url))
          const fullText =
            (await readLatestCompletedHandleText(child)) || `(no text output)`
          results.push(`${childRow.kind ?? childRow.key}=${fullText}`)
        }
        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `idle`
        })
        bridge.onToolCallEnd(
          `call-wait_for_results`,
          `wait_for_results`,
          { resultCount: results.length },
          false
        )
        return `results:${results.join(`;`)}`
      }

      return `unknown:${trimmed}`
    },
  })
}

function createPeerReviewWorkerAssistant(opts: {
  reviews: StateCollectionProxy<ReviewRow>
  reviewer: string
  score: number
  feedback: string
}): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `peer-review-worker`,
    runCommand: async (message) => {
      const artifact = message.trim()
      opts.reviews.insert({
        key: `review-${opts.reviewer}`,
        reviewer: opts.reviewer,
        score: opts.score,
        feedback: `${opts.feedback} :: ${artifact}`,
      })
      return `review:${opts.reviewer}:${opts.score}`
    },
  })
}

function createPeerReviewAssistant(
  ctx: HandlerContext,
  shared: {
    reviews: StateCollectionProxy<ReviewRow>
  },
  reviewers: ReadonlyArray<{
    id: string
    reviewer: string
    score: number
    feedback: string
  }>
): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `peer-review-parent`,
    runCommand: async (message, bridge) => {
      const trimmed = message.trim()
      const children = buildStateProxy<ChildRow>(ctx.db, `children`)
      const status = buildStateProxy<{
        key: string
        value: string
      }>(ctx.db, `status`)
      const parentId = entityIdFromUrl(ctx.entityUrl)
      const sharedStateId = `review-${parentId}`

      if (trimmed.startsWith(`start_review `)) {
        const artifact = trimmed.slice(`start_review `.length)
        bridge.onToolCallStart(`call-start_review`, `start_review`, {
          artifact,
        })
        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `reviewing`
        })

        for (const reviewer of reviewers) {
          const existingChild = children.get(reviewer.id)
          const child = existingChild?.url
            ? await ctx.observe(entity(existingChild.url))
            : await ctx.spawn(
                TYPES.i1ReviewWorker,
                `${parentId}-${reviewer.id}`,
                {
                  reviewer: reviewer.reviewer,
                  score: reviewer.score,
                  feedback: reviewer.feedback,
                  sharedStateId,
                },
                { initialMessage: artifact }
              )
          if (existingChild?.url) {
            child.send(artifact)
          }
          upsertChildRow(children, {
            key: reviewer.id,
            url: child.entityUrl,
            kind: reviewer.id,
          })
        }

        bridge.onToolCallEnd(
          `call-start_review`,
          `start_review`,
          { reviewers: reviewers.map((reviewer) => reviewer.id) },
          false
        )
        return `started:${reviewers.map((reviewer) => reviewer.id).join(`,`)}`
      }

      if (trimmed === `summarize_reviews`) {
        bridge.onToolCallStart(
          `call-summarize_reviews`,
          `summarize_reviews`,
          {}
        )
        const rows = reviewers
          .map((reviewer) => shared.reviews.get(`review-${reviewer.reviewer}`))
          .filter(Boolean) as Array<ReviewRow>

        if (rows.length === 0) {
          bridge.onToolCallEnd(
            `call-summarize_reviews`,
            `summarize_reviews`,
            { count: 0 },
            true
          )
          return `No reviews have been written yet.`
        }

        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `summarizing`
        })

        const average =
          rows.reduce((sum, row) => sum + row.score, 0) / rows.length
        const ordered = rows
          .map((row) => `${row.reviewer}:${row.score}`)
          .join(`;`)

        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `done`
        })
        bridge.onToolCallEnd(
          `call-summarize_reviews`,
          `summarize_reviews`,
          { count: rows.length },
          false
        )
        return `average:${average.toFixed(1)};count:${rows.length};${ordered}`
      }

      return `unknown:${trimmed}`
    },
  })
}

function createDebateWorkerAssistant(opts: {
  argumentsState: StateCollectionProxy<ArgumentRow>
  side: `pro` | `con`
  tone: string
}): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `debate-worker`,
    runCommand: async (message) => {
      const topic = message.trim()
      opts.argumentsState.insert({
        key: `${opts.side}-1`,
        side: opts.side,
        text: `${opts.tone} :: ${topic}`,
        round: 1,
      })
      return `${opts.side}:argument`
    },
  })
}

function createDebateAssistant(
  ctx: HandlerContext,
  shared: {
    arguments: StateCollectionProxy<ArgumentRow>
  }
): TestAgentSpec {
  const debaters = [
    { id: `pro`, side: `pro` as const, tone: `benefits outweigh risks` },
    { id: `con`, side: `con` as const, tone: `risks outweigh benefits` },
  ]

  return createCommandTestAgent({
    modelId: `debate-parent`,
    runCommand: async (message, bridge) => {
      const trimmed = message.trim()
      const children = buildStateProxy<ChildRow>(ctx.db, `children`)
      const status = buildStateProxy<{
        key: string
        value: string
      }>(ctx.db, `status`)
      const parentId = entityIdFromUrl(ctx.entityUrl)
      const sharedStateId = `debate-${parentId}`
      const spawnDebaters = async (
        debatersToSpawn: ReadonlyArray<(typeof debaters)[number]>,
        topic: string
      ): Promise<void> => {
        for (const debater of debatersToSpawn) {
          const existingChild = children.get(debater.id)
          const child = existingChild?.url
            ? await ctx.observe(entity(existingChild.url))
            : await ctx.spawn(
                TYPES.j1DebateWorker,
                `${parentId}-${debater.id}`,
                {
                  side: debater.side,
                  tone: debater.tone,
                  sharedStateId,
                },
                { initialMessage: topic }
              )
          if (existingChild?.url) {
            child.send(topic)
          }
          upsertChildRow(children, {
            key: debater.id,
            url: child.entityUrl,
            kind: debater.id,
          })
        }
      }

      if (trimmed.startsWith(`start_debate `)) {
        const topic = trimmed.slice(`start_debate `.length)
        bridge.onToolCallStart(`call-start_debate`, `start_debate`, { topic })
        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `debating`
        })
        await spawnDebaters(debaters, topic)

        bridge.onToolCallEnd(
          `call-start_debate`,
          `start_debate`,
          { topic },
          false
        )
        return `started:${topic}`
      }

      if (trimmed.startsWith(`start_side `)) {
        const match = trimmed.match(/^start_side\s+(pro|con)\s+(.+)$/)
        const side = match?.[1] as `pro` | `con` | undefined
        const topic = match?.[2] ?? ``
        if (!side || !topic) {
          return `invalid:start_side`
        }

        const debater = debaters.find((candidate) => candidate.id === side)
        if (!debater) {
          return `invalid:start_side`
        }

        bridge.onToolCallStart(`call-start_side`, `start_side`, { side, topic })
        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `debating`
        })
        await spawnDebaters([debater], topic)
        bridge.onToolCallEnd(
          `call-start_side`,
          `start_side`,
          { side, topic },
          false
        )
        return `started:${side}:${topic}`
      }

      if (trimmed === `end_debate`) {
        bridge.onToolCallStart(`call-end_debate`, `end_debate`, {})
        const pro = shared.arguments.get(`pro-1`)
        const con = shared.arguments.get(`con-1`)

        if (!pro || !con) {
          bridge.onToolCallEnd(
            `call-end_debate`,
            `end_debate`,
            { count: 0 },
            true
          )
          return `No debate arguments have been recorded yet.`
        }

        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `ruling`
        })

        status.update(`current`, (draft: Record<string, unknown>) => {
          draft.value = `done`
        })
        bridge.onToolCallEnd(
          `call-end_debate`,
          `end_debate`,
          { count: 2 },
          false
        )
        return [`winner:pro`, `pro:${pro.text}`, `con:${con.text}`].join(`;`)
      }

      return `unknown:${trimmed}`
    },
  })
}

function createWikiWorkerAssistant(opts: {
  articles: StateCollectionProxy<WikiKnowledgeRow>
  subtopic: string
}): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `wiki-worker`,
    runCommand: async (message) => {
      const topic = message.trim()
      const slug = opts.subtopic.toLowerCase().replace(/\s+/g, `-`)
      opts.articles.insert({
        key: `${slug}-1`,
        topic: `${opts.subtopic} Basics`,
        content: `${opts.subtopic} overview for ${topic}`,
        author: `${opts.subtopic} Specialist`,
      })
      return `wiki:${opts.subtopic}:1`
    },
  })
}

function createWikiAssistant(
  ctx: HandlerContext,
  shared: {
    articles: StateCollectionProxy<WikiKnowledgeRow>
  }
): TestAgentSpec {
  return createCommandTestAgent({
    modelId: `wiki-parent`,
    runCommand: async (message, bridge) => {
      const trimmed = message.trim()
      const children = buildStateProxy<ChildRow>(ctx.db, `children`)
      const meta = buildStateProxy<WikiMetaRow>(ctx.db, `meta`)
      const parentId = entityIdFromUrl(ctx.entityUrl)
      const sharedStateId = `wiki-${parentId}`

      if (trimmed.startsWith(`create_wiki `)) {
        const match = trimmed.match(/^create_wiki\s+(.+?)\s*::\s*(.+)$/)
        if (!match) {
          return `invalid:create_wiki`
        }
        const topic = match[1]!
        const rawSubtopics = match[2] ?? ``
        const subtopics = rawSubtopics
          .split(`|`)
          .map((part) => part.trim())
          .filter(Boolean)

        bridge.onToolCallStart(`call-create_wiki`, `create_wiki`, {
          topic,
          specialistCount: subtopics.length,
        })

        const existingMeta = meta.get(`wiki`)
        if (existingMeta && existingMeta.topic !== topic) {
          bridge.onToolCallEnd(
            `call-create_wiki`,
            `create_wiki`,
            { topic, existingTopic: existingMeta.topic },
            true
          )
          return `Wiki topic is already "${existingMeta.topic}" and cannot be changed to "${topic}".`
        }

        if (!existingMeta) {
          meta.insert({
            key: `wiki`,
            topic,
            specialistCount: subtopics.length,
          })
        } else if (subtopics.length > existingMeta.specialistCount) {
          meta.update(`wiki`, (draft) => {
            draft.specialistCount = subtopics.length
          })
        }

        let spawned = 0
        let reused = 0

        for (const subtopic of subtopics) {
          const childKey = subtopic.toLowerCase().replace(/\s+/g, `-`)
          const existingChild = children.get(childKey)
          if (!existingChild?.url) {
            const child = await ctx.spawn(
              TYPES.k1WikiWorker,
              `${parentId}-${childKey}`,
              {
                subtopic,
                sharedStateId,
              },
              { initialMessage: topic }
            )
            children.insert({
              key: childKey,
              url: child.entityUrl,
              kind: subtopic,
              articleKey: null,
              articleTopic: null,
              articleAuthor: null,
            })
            spawned++
          } else {
            reused++
          }
        }

        bridge.onToolCallEnd(
          `call-create_wiki`,
          `create_wiki`,
          { topic, subtopics, spawned, reused },
          false
        )
        return `wiki_started:${spawned}:${reused}:${subtopics.join(`,`)}`
      }

      if (trimmed.startsWith(`query_wiki `)) {
        const query = trimmed.slice(`query_wiki `.length)
        bridge.onToolCallStart(`call-query_wiki`, `query_wiki`, { query })

        const rows = [...shared.articles.toArray].sort((left, right) =>
          left.key.localeCompare(right.key)
        )

        if (rows.length === 0) {
          bridge.onToolCallEnd(
            `call-query_wiki`,
            `query_wiki`,
            { articleCount: 0 },
            false
          )
          return `No wiki articles have been written yet.`
        }

        const summary = rows.map((row) => `${row.key}:${row.topic}`).join(`;`)

        bridge.onToolCallEnd(
          `call-query_wiki`,
          `query_wiki`,
          { articleCount: rows.length },
          false
        )
        return `articles:${rows.length};${summary}`
      }

      if (trimmed === `get_wiki_status`) {
        bridge.onToolCallStart(`call-get_wiki_status`, `get_wiki_status`, {})
        const rows = [...children.toArray]
        const completeCount = shared.articles.toArray.length
        const pending = rows
          .slice(completeCount)
          .map((row) => row.kind ?? row.key)
          .join(`,`)
        bridge.onToolCallEnd(
          `call-get_wiki_status`,
          `get_wiki_status`,
          {
            complete: completeCount,
            total: rows.length,
          },
          false
        )
        return `status:${completeCount}/${rows.length};pending:${pending || `none`}`
      }

      return `unknown:${trimmed}`
    },
  })
}

const ssDataRowSchema = z.object({
  key: z.string(),
  value: z.string(),
})

const ssDataSchema = {
  data: {
    schema: ssDataRowSchema,
    type: `shared:ss_data`,
    primaryKey: `key`,
  },
}

const TYPES = {
  a1: `basic-a1`,
  a2: `basic-a2`,
  a3: `runner-a3`,
  a4: `texter-a4`,
  a5: `multi-a5`,
  a6: `noagent-a6`,
  a7: `stateful-a7`,
  a8: `manifested-a8`,
  a9: `toolful-a9`,
  b1Parent: `parent-b1`,
  b1Child: `child-type-b1`,
  b2Parent: `parent2-b2`,
  b2Child: `child-type2-b2`,
  b3Parent: `spawner-b3`,
  b3Child: `spawned-b3`,
  b4Parent: `obs-parent-b4`,
  b4Child: `obs-child-b4`,
  c1: `state-writer-c1`,
  c2: `status-entity-c2`,
  c3: `state-loop-c3`,
  d1: `ss-creator-d1`,
  d2: `ss-creator2-d2`,
  d3: `ss-writer-d3`,
  d4: `ss-creator-d4`,
  d5: `ss-reader-d5`,
  d6Writer: `ss-writer-d6`,
  d6Reader: `ss-reader-d6`,
  d9: `ss-effect-d9`,
  e1Child: `observed-child-e1`,
  e1Parent: `observing-parent-e1`,
  e2Parent: `observing-parent-e2`,
  l1Watcher: `observation-watcher-l1`,
  f1AssistantChild: `dispatch-assistant-f1`,
  f1WorkerChild: `dispatch-worker-f1`,
  f1Dispatcher: `dispatcher-f1`,
  f2Manager: `manager-f2`,
  fCoordWorker: `coord-worker-f`,
  g1MapReduce: `map-reduce-g1`,
  h1Pipeline: `pipeline-h1`,
  m1ResearchWorker: `research-worker-m1`,
  m1Researcher: `deep-researcher-m1`,
  i1ReviewWorker: `review-worker-i1`,
  i1PeerReview: `peer-review-i1`,
  j1DebateWorker: `debate-worker-j1`,
  j1Debate: `debate-parent-j1`,
  k1WikiWorker: `wiki-worker-k1`,
  k1Wiki: `wiki-parent-k1`,
  n1WakeTypeParent: `wake-type-parent-n1`,
  n1WakeTypeChild: `wake-type-child-n1`,
  n2SsWakeWriter: `ss-wake-writer-n2`,
  n2SsWakeSubscriber: `ss-wake-subscriber-n2`,
  n3IdleWakeParent: `idle-wake-parent-n3`,
  n3IdleWakeChild: `idle-wake-child-n3`,
  n4WakeSummaryParent: `wake-summary-parent-n4`,
  n4WakeSummaryChild: `wake-summary-child-n4`,
} as const

t.define(TYPES.a1, {
  handler() {},
})
t.define(TYPES.a2, {
  handler() {},
})
t.define(TYPES.a3, {
  async handler(ctx) {
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`reply`],
    })
  },
})
t.define(TYPES.a4, {
  async handler(ctx) {
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`Hello world`],
    })
  },
})
t.define(TYPES.a5, {
  async handler(ctx) {
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`first`, `second`],
    })
  },
})
t.define(TYPES.a6, {
  handler() {},
})
t.define(TYPES.a7, {
  state: { status: { schema: statusRowSchema, primaryKey: `key` } },
  async handler(ctx) {
    const status = buildStateProxy<{ key: string; value: string }>(
      ctx.db,
      `status`
    )
    if (!status.get(`current`)) {
      status.insert({
        key: `current`,
        value: `idle`,
      })
    }
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`ok`],
    })
  },
})
t.define(TYPES.a8, {
  async handler(ctx) {
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`hi`],
    })
  },
})
t.define(TYPES.a9, {
  state: { notes: { schema: noteRowSchema, primaryKey: `key` } },
  async handler(ctx) {
    const notes = buildStateProxy<NoteRow>(ctx.db, `notes`)
    await runTestAgent(
      ctx,
      createFakeToolAssistant({
        notes,
      })
    )
  },
})
t.define(TYPES.b1Parent, {
  async handler(ctx) {
    await ctx.spawn(TYPES.b1Child, `c-1`)
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`spawned`],
    })
  },
})
t.define(TYPES.b1Child, { handler() {} })
t.define(TYPES.b2Parent, {
  async handler(ctx) {
    await ctx.spawn(TYPES.b2Child, `c-2`, {}, { initialMessage: `hello child` })
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`done`],
    })
  },
})
t.define(TYPES.b2Child, { handler() {} })
t.define(TYPES.b3Parent, {
  async handler(ctx) {
    await ctx.spawn(TYPES.b3Child, `sp-1`)
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`ok`],
    })
  },
})
t.define(TYPES.b3Child, { handler() {} })
t.define(TYPES.b4Parent, {
  async handler(ctx) {
    await ctx.spawn(TYPES.b4Child, `oc-1`)
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`ok`],
    })
  },
})
t.define(TYPES.b4Child, { handler() {} })
t.define(TYPES.c1, {
  state: { items: { schema: itemRowSchema, primaryKey: `key` } },
  async handler(ctx) {
    const items = buildStateProxy<{ key: string; value: string }>(
      ctx.db,
      `items`
    )
    if (!items.get(`item-1`)) {
      items.insert({
        key: `item-1`,
        value: `hello`,
      })
    }
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`ok`],
    })
  },
})
t.define(TYPES.c2, {
  state: { status: { schema: statusRowSchema, primaryKey: `key` } },
  async handler(ctx) {
    const status = buildStateProxy<{ key: string; value: string }>(
      ctx.db,
      `status`
    )
    if (!status.get(`current`)) {
      status.insert({
        key: `current`,
        value: `idle`,
      })
    }
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`ok`],
    })
  },
})
t.define(TYPES.c3, {
  state: { notes: { schema: noteRowSchema, primaryKey: `key` } },
  async handler(ctx) {
    const notes = buildStateProxy<NoteRow>(ctx.db, `notes`)
    if (!notes.get(`note-1`)) {
      notes.insert({ key: `note-1`, text: `saved` })
    }
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`saved`],
    })
  },
})
t.define(TYPES.d1, {
  async handler(ctx) {
    if (ctx.firstWake) ctx.mkdb(`ss-d1`, articleSchema)
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`created`],
    })
  },
})
t.define(TYPES.d2, {
  async handler(ctx) {
    if (ctx.firstWake) ctx.mkdb(`ss-d2`, articleSchema)
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`created`],
    })
  },
})
t.define(TYPES.d3, {
  async handler(ctx) {
    if (ctx.firstWake) ctx.mkdb(`ss-d3`, articleSchema)
    const shared = (await ctx.observe(
      db(`ss-d3`, articleSchema)
    )) as unknown as SharedStateHandle<typeof articleSchema>
    if (!shared.articles.get(`art-1`)) {
      shared.articles.insert({
        key: `art-1`,
        title: `Test Article`,
        content: `Hello`,
      })
    }
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`wrote article`],
    })
  },
})
t.define(TYPES.d4, {
  async handler(ctx) {
    const args = ctx.args as unknown as { sharedStateId: string }
    if (ctx.firstWake) ctx.mkdb(args.sharedStateId, articleSchema)
    const shared = (await ctx.observe(
      db(args.sharedStateId, articleSchema)
    )) as unknown as SharedStateHandle<typeof articleSchema>
    await runTestAgent(
      ctx,
      createSharedStateCrudAssistant({
        articles:
          shared.articles as unknown as StateCollectionProxy<ArticleRow>,
      })
    )
  },
})
t.define(TYPES.d5, {
  async handler(ctx) {
    const args = ctx.args as unknown as { sharedStateId: string }
    const shared = await ctx.observe(db(args.sharedStateId, articleSchema))
    await runTestAgent(
      ctx,
      createSharedStateCrudAssistant({
        articles:
          shared.articles as unknown as StateCollectionProxy<ArticleRow>,
      })
    )
  },
})
t.define(TYPES.d6Writer, {
  async handler(ctx) {
    const args = ctx.args as unknown as { sharedStateId: string }
    if (ctx.firstWake) ctx.mkdb(args.sharedStateId, articleCommentSchema)
    const shared = (await ctx.observe(
      db(args.sharedStateId, articleCommentSchema)
    )) as unknown as SharedStateHandle<typeof articleCommentSchema>
    await runTestAgent(
      ctx,
      createMultiCollectionSharedStateAssistant({
        articles:
          shared.articles as unknown as StateCollectionProxy<ArticleRow>,
        comments:
          shared.comments as unknown as StateCollectionProxy<CommentRow>,
      })
    )
  },
})
t.define(TYPES.d6Reader, {
  async handler(ctx) {
    const args = ctx.args as unknown as { sharedStateId: string }
    const shared = await ctx.observe(
      db(args.sharedStateId, articleCommentSchema)
    )
    await runTestAgent(
      ctx,
      createMultiCollectionSharedStateAssistant({
        articles:
          shared.articles as unknown as StateCollectionProxy<ArticleRow>,
        comments:
          shared.comments as unknown as StateCollectionProxy<CommentRow>,
      })
    )
  },
})
t.define(TYPES.d9, {
  state: {
    notices: {
      schema: noteRowSchema,
      primaryKey: `key`,
      type: `state:notice`,
    },
  },
  async handler(ctx) {
    const args = ctx.args as unknown as { sharedStateId: string }
    if (ctx.firstWake) ctx.mkdb(args.sharedStateId, articleSchema)
    const shared = (await ctx.observe(
      db(args.sharedStateId, articleSchema)
    )) as unknown as SharedStateHandle<typeof articleSchema>
    const notices = buildStateProxy<NoteRow>(ctx.db, `notices`)
    await runTestAgent(
      ctx,
      createSharedStateCrudAssistant({
        articles:
          shared.articles as unknown as StateCollectionProxy<ArticleRow>,
      })
    )
    // After agent runs, check for new articles and write notices
    const articles = (
      shared.articles as unknown as StateCollectionProxy<ArticleRow>
    ).toArray
    for (const article of articles) {
      const existing = notices.get(article.key)
      if (existing) {
        notices.update(article.key, (draft) => {
          draft.text = `noticed:${article.title}`
        })
      } else {
        notices.insert({ key: article.key, text: `noticed:${article.title}` })
      }
    }
  },
})
t.define(TYPES.e1Child, {
  state: {
    items: {
      schema: observedItemRowSchema,
      primaryKey: `key`,
      type: `observed_item`,
    },
  },
  async handler(ctx) {
    const items = buildStateProxy<ObservedItemRow>(ctx.db, `items`)
    await runTestAgent(
      ctx,
      createLocalItemCrudAssistant({
        items,
      })
    )
  },
})
t.define(TYPES.e1Parent, {
  state: {
    observedCounts: {
      schema: observedCountRowSchema,
      primaryKey: `key`,
      type: `observed_count`,
    },
  },
  async handler(ctx) {
    const args = ctx.args as unknown as { childUrl: string }
    const child = await ctx.observe(entity(args.childUrl))
    const observedCounts = buildStateProxy<ObservedCountRow>(
      ctx.db,
      `observedCounts`
    )
    // Reconcile: count items in observed child
    const childItems = collectionRows<ObservedItemRow>(
      child.db.collections.items
    )
    for (const item of childItems) {
      const existing = observedCounts.get(item.key)
      if (existing) {
        observedCounts.update(item.key, (draft) => {
          draft.count = 1
        })
      } else {
        observedCounts.insert({ key: item.key, count: 1 })
      }
    }
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`ack`],
    })
  },
})
t.define(TYPES.e2Parent, {
  state: {
    mirroredItems: {
      schema: observedItemRowSchema,
      primaryKey: `key`,
      type: `mirrored_item`,
    },
  },
  async handler(ctx) {
    const args = ctx.args as unknown as { childUrl: string }
    const child = await ctx.observe(entity(args.childUrl))
    const mirroredItems = buildStateProxy<ObservedItemRow>(
      ctx.db,
      `mirroredItems`
    )
    // Mirror: sync items from observed child
    const childItems = collectionRows<ObservedItemRow>(
      child.db.collections.items
    )
    for (const item of childItems) {
      const existing = mirroredItems.get(item.key)
      if (existing) {
        mirroredItems.update(item.key, (draft) => {
          draft.value = item.value
        })
      } else {
        mirroredItems.insert({ key: item.key, value: item.value })
      }
    }
    await runTestAgent(ctx, {
      model: `test`,
      testResponses: [`ack`],
    })
  },
})
t.define(TYPES.l1Watcher, {
  state: {
    notices: {
      schema: noteRowSchema,
      primaryKey: `key`,
      type: `state:notice`,
    },
    _mirror: {
      schema: watcherMirrorRowSchema,
      primaryKey: `key`,
    },
  },
  async handler(ctx, wake) {
    const notices = buildStateProxy<ObservationNoticeRow>(ctx.db, `notices`)
    const mirror = buildStateProxy<{
      key: string
      childUrl: string
      itemKey: string
      value: string
    }>(ctx.db, `_mirror`)

    const watchedChildren = new Set<string>()
    const selfManifest = await queryOnce((q) =>
      q.from({ manifests: ctx.db.collections.manifests })
    )
    for (const entry of selfManifest) {
      if (
        entry.kind === `source` &&
        entry.sourceType === `entity` &&
        String(entry.config.entityUrl) !== ctx.entityUrl
      ) {
        watchedChildren.add(String(entry.config.entityUrl))
      }
    }

    const watchChild = async (url: string): Promise<boolean> => {
      if (watchedChildren.has(url)) {
        return false
      }
      await ctx.observe(entity(url), {
        wake: { on: `change` as const, collections: [`observed_item`] },
      })
      watchedChildren.add(url)
      return true
    }

    if (wake.type === `message_received`) {
      await runTestAgent(
        ctx,
        createObservationRelayAssistant({
          watchChild,
          notices,
        })
      )
    }

    for (const childUrl of watchedChildren) {
      const handle = await ctx.observe(entity(childUrl), {
        wake: { on: `change` as const, collections: [`observed_item`] },
      })
      const itemsCollection = handle.db.collections.items
      if (!itemsCollection) {
        throw new Error(`items collection missing for observed child`)
      }
      const currentItems = collectionRows<{
        key: string
        value: string
      }>(itemsCollection)

      // Build map of mirrored items for this child
      const mirrorCollection = ctx.db.collections._mirror
      if (!mirrorCollection) {
        throw new Error(`_mirror collection missing for watcher`)
      }
      const mirroredForChild = new Map<string, { key: string; value: string }>()
      for (const m of collectionRows<{
        key: string
        childUrl: string
        itemKey: string
        value: string
      }>(mirrorCollection)) {
        if (m.childUrl === childUrl) {
          mirroredForChild.set(m.itemKey, { key: m.key, value: m.value })
        }
      }

      // Detect inserts and updates
      const currentKeys = new Set<string>()
      for (const item of currentItems) {
        currentKeys.add(item.key)
        const mirrored = mirroredForChild.get(item.key)
        if (!mirrored) {
          // Insert
          const noticeKey = `notice-${String(notices.toArray.length + 1).padStart(4, `0`)}`
          notices.insert({
            key: noticeKey,
            text: `insert:items:${item.key}:${item.value}`,
          })
          mirror.insert({
            key: `${childUrl}::${item.key}`,
            childUrl,
            itemKey: item.key,
            value: item.value,
          })
        } else if (mirrored.value !== item.value) {
          // Update
          const noticeKey = `notice-${String(notices.toArray.length + 1).padStart(4, `0`)}`
          notices.insert({
            key: noticeKey,
            text: `update:items:${item.key}:${mirrored.value}->${item.value}`,
          })
          mirror.update(`${childUrl}::${item.key}`, (draft) => {
            draft.value = item.value
          })
        }
      }

      // Detect deletes
      for (const [itemKey, mirrored] of mirroredForChild) {
        if (!currentKeys.has(itemKey)) {
          const noticeKey = `notice-${String(notices.toArray.length + 1).padStart(4, `0`)}`
          notices.insert({
            key: noticeKey,
            text: `delete:items:${itemKey}:${mirrored.value}`,
          })
          mirror.delete(`${childUrl}::${itemKey}`)
        }
      }
    }
  },
})
t.define(TYPES.f1AssistantChild, {
  async handler(ctx) {
    await runTestAgent(
      ctx,
      createDeterministicChildAssistant({ label: `assistant` })
    )
  },
})
t.define(TYPES.f1WorkerChild, {
  async handler(ctx) {
    await runTestAgent(
      ctx,
      createDeterministicChildAssistant({ label: `worker` })
    )
  },
})
t.define(TYPES.fCoordWorker, {
  async handler(ctx) {
    const args = ctx.args as { label: string; delayMs?: number }
    await runTestAgent(ctx, createDeterministicChildAssistant(args))
  },
})
t.define(TYPES.f1Dispatcher, {
  state: {
    status: { schema: statusRowSchema, primaryKey: `key` },
    counters: { primaryKey: `key` },
    children: { schema: childRowSchema, primaryKey: `key` },
  },
  async handler(ctx) {
    const status = buildStateProxy<{ key: string; value: string }>(
      ctx.db,
      `status`
    )
    if (!status.get(`current`)) {
      status.insert({ key: `current`, value: `idle` })
    }
    await runTestAgent(ctx, createDispatcherAssistant(ctx))
  },
})
t.define(TYPES.f2Manager, {
  state: {
    status: { schema: statusRowSchema, primaryKey: `key` },
    children: { schema: childRowSchema, primaryKey: `key` },
    childStatus: {
      schema: childStatusRowSchema,
      primaryKey: `key`,
      type: `child_status`,
    },
  },
  async handler(ctx, wake) {
    const status = buildStateProxy<{ key: string; value: string }>(
      ctx.db,
      `status`
    )
    if (!status.get(`current`)) {
      status.insert({ key: `current`, value: `idle` })
    }
    if (wake.type === `message_received`) {
      await runTestAgent(ctx, createManagerWorkerAssistant(ctx))
    }

    const childStatus = buildStateProxy<{ key: string; status: string }>(
      ctx.db,
      `childStatus`
    )
    const childrenCollection = ctx.db.collections.children
    if (!childrenCollection) {
      throw new Error(`children collection missing for manager`)
    }
    const childKeyByUrl = new Map(
      collectionRows<{
        key: string
        url: string
      }>(childrenCollection)
        .filter((child) => Boolean(child.url))
        .map((child) => [child.url, child.key] as const)
    )

    const applyWakeStatus = (wakeValue: Record<string, unknown>): void => {
      const finishedChild =
        typeof wakeValue.finished_child === `object` &&
        wakeValue.finished_child !== null
          ? (wakeValue.finished_child as Record<string, unknown>)
          : null
      if (finishedChild) {
        const childUrl = String(finishedChild.url ?? ``)
        const childKey = childKeyByUrl.get(childUrl)
        const runStatus = String(finishedChild.run_status ?? ``)
        if (childKey && runStatus) {
          upsertChildStatusRow(childStatus, childKey, runStatus)
        }
      }
    }

    const wakesCollection = ctx.db.collections.wakes

    for (const wakeEntry of sortRowsByCollectionOrder(wakesCollection)) {
      applyWakeStatus(wakeEntry as unknown as Record<string, unknown>)
    }
  },
})
t.define(TYPES.g1MapReduce, {
  state: {
    status: { schema: statusRowSchema, primaryKey: `key` },
    children: { schema: childRowSchema, primaryKey: `key` },
  },
  async handler(ctx) {
    const status = buildStateProxy<{ key: string; value: string }>(
      ctx.db,
      `status`
    )
    if (!status.get(`current`)) {
      status.insert({ key: `current`, value: `idle` })
    }
    await runTestAgent(ctx, createMapReduceAssistant(ctx))
  },
})
t.define(TYPES.h1Pipeline, {
  state: {
    status: { schema: statusRowSchema, primaryKey: `key` },
    pipeline: { schema: pipelineStateRowSchema, primaryKey: `key` },
    children: { schema: childRowSchema, primaryKey: `key` },
  },
  async handler(ctx) {
    const status = buildStateProxy<{ key: string; value: string }>(
      ctx.db,
      `status`
    )
    const pipeline = buildStateProxy<PipelineStateRow>(ctx.db, `pipeline`)
    if (!status.get(`current`)) {
      status.insert({ key: `current`, value: `idle` })
    }
    if (!pipeline.get(`state`)) {
      pipeline.insert({
        key: `state`,
        currentInput: ``,
        currentStage: 0,
      })
    }
    await runTestAgent(ctx, createPipelineAssistant(ctx))
  },
})
t.define(TYPES.m1ResearchWorker, {
  async handler(ctx) {
    const args = ctx.args as { subtopic: string }
    await runTestAgent(ctx, createResearchWorkerAssistant(args))
  },
})
t.define(TYPES.m1Researcher, {
  state: {
    status: { schema: statusRowSchema, primaryKey: `key` },
    children: { schema: childRowSchema, primaryKey: `key` },
  },
  async handler(ctx) {
    const status = buildStateProxy<{ key: string; value: string }>(
      ctx.db,
      `status`
    )
    if (!status.get(`current`)) {
      status.insert({ key: `current`, value: `idle` })
    }
    await runTestAgent(ctx, createResearchAssistant(ctx))
  },
})
t.define(TYPES.i1ReviewWorker, {
  async handler(ctx) {
    const args = ctx.args as {
      reviewer: string
      score: number
      feedback: string
      sharedStateId: string
    }
    const shared = await ctx.observe(db(args.sharedStateId, reviewSchema))
    await runTestAgent(
      ctx,
      createPeerReviewWorkerAssistant({
        reviews: shared.reviews as unknown as StateCollectionProxy<ReviewRow>,
        reviewer: args.reviewer,
        score: args.score,
        feedback: args.feedback,
      })
    )
  },
})
t.define(TYPES.i1PeerReview, {
  state: {
    status: { schema: statusRowSchema, primaryKey: `key` },
    children: { schema: childRowSchema, primaryKey: `key` },
  },
  async handler(ctx) {
    const parentId = entityIdFromUrl(ctx.entityUrl)
    const status = buildStateProxy<{ key: string; value: string }>(
      ctx.db,
      `status`
    )
    if (!status.get(`current`)) {
      status.insert({ key: `current`, value: `idle` })
    }
    const requestedReviewerCount =
      typeof ctx.args.reviewerCount === `number`
        ? Math.max(
            1,
            Math.min(peerReviewerCatalog.length, ctx.args.reviewerCount)
          )
        : peerReviewerCatalog.length
    if (ctx.firstWake) ctx.mkdb(`review-${parentId}`, reviewSchema)
    const shared = (await ctx.observe(
      db(`review-${parentId}`, reviewSchema)
    )) as unknown as SharedStateHandle<typeof reviewSchema>
    const count = Math.max(
      1,
      Math.min(peerReviewerCatalog.length, requestedReviewerCount)
    )
    await runTestAgent(
      ctx,
      createPeerReviewAssistant(
        ctx,
        {
          reviews: shared.reviews as unknown as StateCollectionProxy<ReviewRow>,
        },
        peerReviewerCatalog.slice(0, count)
      )
    )
  },
})
t.define(TYPES.j1DebateWorker, {
  async handler(ctx) {
    const args = ctx.args as {
      side: `pro` | `con`
      tone: string
      sharedStateId: string
    }
    const shared = await ctx.observe(db(args.sharedStateId, debateSchema))
    await runTestAgent(
      ctx,
      createDebateWorkerAssistant({
        argumentsState:
          shared.arguments as unknown as StateCollectionProxy<ArgumentRow>,
        side: args.side,
        tone: args.tone,
      })
    )
  },
})
t.define(TYPES.j1Debate, {
  state: {
    status: { schema: statusRowSchema, primaryKey: `key` },
    children: { schema: childRowSchema, primaryKey: `key` },
  },
  async handler(ctx) {
    const parentId = entityIdFromUrl(ctx.entityUrl)
    const status = buildStateProxy<{ key: string; value: string }>(
      ctx.db,
      `status`
    )
    if (!status.get(`current`)) {
      status.insert({ key: `current`, value: `idle` })
    }
    if (ctx.firstWake) ctx.mkdb(`debate-${parentId}`, debateSchema)
    const shared = (await ctx.observe(
      db(`debate-${parentId}`, debateSchema)
    )) as unknown as SharedStateHandle<typeof debateSchema>
    await runTestAgent(
      ctx,
      createDebateAssistant(ctx, {
        arguments:
          shared.arguments as unknown as StateCollectionProxy<ArgumentRow>,
      })
    )
  },
})
t.define(TYPES.k1WikiWorker, {
  async handler(ctx) {
    const args = ctx.args as { subtopic: string; sharedStateId: string }
    const shared = await ctx.observe(
      db(args.sharedStateId, wikiKnowledgeSchema)
    )
    await runTestAgent(
      ctx,
      createWikiWorkerAssistant({
        articles:
          shared.articles as unknown as StateCollectionProxy<WikiKnowledgeRow>,
        subtopic: args.subtopic,
      })
    )
  },
})

t.define(TYPES.k1Wiki, {
  state: {
    meta: { schema: wikiMetaRowSchema, primaryKey: `key` },
    children: { schema: childRowSchema, primaryKey: `key` },
  },
  async handler(ctx) {
    const parentId = entityIdFromUrl(ctx.entityUrl)
    if (ctx.firstWake) ctx.mkdb(`wiki-${parentId}`, wikiKnowledgeSchema)
    const shared = (await ctx.observe(
      db(`wiki-${parentId}`, wikiKnowledgeSchema)
    )) as unknown as SharedStateHandle<typeof wikiKnowledgeSchema>
    await runTestAgent(
      ctx,
      createWikiAssistant(ctx, {
        articles:
          shared.articles as unknown as StateCollectionProxy<WikiKnowledgeRow>,
      })
    )
  },
})

// ── Finding 1 entities: WakeEvent type verification ──────────────────

// Child that completes immediately on any message
t.define(TYPES.n1WakeTypeChild, {
  async handler(ctx) {
    await runTestAgent(
      ctx,
      createCommandTestAgent({
        modelId: `n1-child`,
        runCommand: async (message) => {
          // Give the parent observe+wake registration path a moment to settle
          // before this run finishes; otherwise this verification test can race
          // under full-suite load even though the wake path itself is correct.
          await new Promise((resolve) => setTimeout(resolve, 5))
          return `child-done:${message}`
        },
      })
    )
  },
})

// Parent that spawns child, observes it with wake: "runFinished", and records wake.type
// Uses state collection to record the wake type on every wake invocation.
t.define(TYPES.n1WakeTypeParent, {
  state: {
    wakeLog: {
      type: `wake_log_entry`,
      primaryKey: `key`,
    },
  },
  async handler(ctx, wake) {
    const wakeLog = buildStateProxy<{
      key: string
      wakeType: string
      source: string
    }>(ctx.db, `wakeLog`)

    wakeLog.insert({
      key: `wake-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      wakeType: wake.type,
      source: wake.source,
    })

    await runTestAgent(
      ctx,
      createCommandTestAgent({
        modelId: `n1-parent`,
        runCommand: async (message) => {
          const trimmed = message.trim()
          if (trimmed.startsWith(`spawn_and_observe `)) {
            const childId = trimmed.slice(`spawn_and_observe `.length)
            const child = await ctx.spawn(TYPES.n1WakeTypeChild, childId)
            await ctx.observe(entity(child.entityUrl), {
              wake: `runFinished`,
            })
            child.send(`hello from parent`)
            return `spawned:${childId}:wake.type=${wake.type}`
          }
          return `echo:${trimmed}:wake.type=${wake.type}`
        },
      })
    )
  },
})

// ── Finding 2 entities: observe(db(...)) wake ──────────────────────

// Writer that creates shared state and writes to it
t.define(TYPES.n2SsWakeWriter, {
  async handler(ctx) {
    const ssId = (ctx.args as Record<string, string>).ssId
    if (ssId && ctx.firstWake) ctx.mkdb(ssId, ssDataSchema)
    const shared = ssId
      ? ((await ctx.observe(
          db(ssId, ssDataSchema)
        )) as unknown as SharedStateHandle<typeof ssDataSchema>)
      : null
    await runTestAgent(
      ctx,
      createCommandTestAgent({
        modelId: `n2-writer`,
        runCommand: async (message) => {
          const trimmed = message.trim()
          if (trimmed.startsWith(`write `) && shared) {
            const parts = trimmed.slice(`write `.length).split(` `)
            const dataKey = parts[0] ?? `item-1`
            const dataValue = parts[1] ?? `hello`
            shared.data.insert({ key: dataKey, value: dataValue })
            return `wrote:${dataKey}=${dataValue}`
          }
          return `echo:${trimmed}`
        },
      })
    )
  },
})

// Subscriber that connects to shared state with wake option
t.define(TYPES.n2SsWakeSubscriber, {
  state: {
    wakeLog: {
      type: `ss_wake_log`,
      primaryKey: `key`,
    },
  },
  async handler(ctx, wake) {
    const ssId = (ctx.args as Record<string, string>).ssId
    if (ssId) {
      await ctx.observe(db(ssId, ssDataSchema), {
        wake: { on: `change` as const },
      })
    }
    const wakeLog = buildStateProxy<{
      key: string
      wakeType: string
    }>(ctx.db, `wakeLog`)
    wakeLog.insert({
      key: `wake-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      wakeType: wake.type,
    })

    await runTestAgent(
      ctx,
      createCommandTestAgent({
        modelId: `n2-subscriber`,
        runCommand: async (message) => {
          return `subscriber-response:${message.trim()}:wake.type=${wake.type}`
        },
      })
    )
  },
})

// ── Finding 3 entities: idle-phase wake handling ─────────────────────

// Simple child that completes its run
t.define(TYPES.n3IdleWakeChild, {
  async handler(ctx) {
    await runTestAgent(
      ctx,
      createCommandTestAgent({
        modelId: `n3-child`,
        runCommand: async (message) => {
          return `child-result:${message}`
        },
      })
    )
  },
})

// Parent that spawns child with wake: "runFinished"
t.define(TYPES.n3IdleWakeParent, {
  async handler(ctx, wake) {
    await runTestAgent(
      ctx,
      createCommandTestAgent({
        modelId: `n3-parent`,
        runCommand: async (message) => {
          const trimmed = message.trim()
          if (trimmed.startsWith(`spawn `)) {
            const childId = trimmed.slice(`spawn `.length)
            const child = await ctx.spawn(
              TYPES.n3IdleWakeChild,
              childId,
              {},
              { wake: `runFinished` }
            )
            child.send(`do work`)
            return `spawned:${childId}:wake.type=${wake.type}`
          }
          return `echo:${trimmed}:wake.type=${wake.type}`
        },
      })
    )
  },
})

t.define(TYPES.n4WakeSummaryChild, {
  async handler(ctx) {
    const args = ctx.args as { label: string; delayMs?: number }
    await runTestAgent(ctx, createDeterministicChildAssistant(args))
  },
})

t.define(TYPES.n4WakeSummaryParent, {
  async handler(ctx, wake) {
    if (wake.type === `wake`) {
      return
    }

    await runTestAgent(
      ctx,
      createCommandTestAgent({
        modelId: `n4-parent`,
        runCommand: async (message) => {
          const trimmed = message.trim()
          if (trimmed !== `spawn trio`) {
            return `echo:${trimmed}`
          }

          const parentId = entityIdFromUrl(ctx.entityUrl)
          const childSpecs = [
            { key: `alpha`, delayMs: 50 },
            { key: `bravo`, delayMs: 150 },
            { key: `charlie`, delayMs: 300 },
          ] as const

          for (const spec of childSpecs) {
            await ctx.spawn(
              TYPES.n4WakeSummaryChild,
              `${parentId}-${spec.key}`,
              {
                label: spec.key,
                delayMs: spec.delayMs,
              },
              {
                initialMessage: `run ${spec.key}`,
                wake: `runFinished`,
              }
            )
          }

          return `spawned:${childSpecs.length}`
        },
      })
    )
  },
})

afterAll(async () => {
  await t.cleanup()
}, 180_000)

beforeAll(async () => {
  await t.prepare()
}, 120_000)

afterEach(async () => {
  await t.waitForSettled()
}, 30_000)

describe(`A: basic entity lifecycle`, () => {
  it(`A1: spawn writes entity_created immediately with spawn args`, async () => {
    const entity = await t.spawn(TYPES.a1, `b-1`, {
      plan: `pro`,
      userId: `user-1`,
    })
    const history = await entity.history()

    expect(history.count(`entity_created`)).toBe(1)
    expect(history.find(`entity_created`)?.value).toMatchObject({
      args: { plan: `pro`, userId: `user-1` },
      entity_type: TYPES.a1,
    })
    expect(history.count(`message_received`)).toBe(0)
    expect(history.count(`run`)).toBe(0)
    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 60_000)

  it(`A2: spawn with initial message writes inbox history before any run`, async () => {
    const entity = await t.spawn(
      TYPES.a2,
      `b-2`,
      {},
      { initialMessage: `hello on create` }
    )
    const history = await entity.history()

    expect(history.count(`entity_created`)).toBe(1)
    expect(history.count(`message_received`)).toBe(1)
    expect(history.count(`run`)).toBe(0)
    expect(history.indexOf(`entity_created`)).toBeLessThan(
      history.indexOf(`message_received`)
    )
    expect(history.find(`message_received`)?.value).toMatchObject({
      payload: `hello on create`,
    })
    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 60_000)

  it(`A3: single message produces a full run history`, async () => {
    const entity = await t.spawn(TYPES.a3, `r-1`)
    await entity.send(`hello`, { from: `user` })
    await entity.waitForRun()

    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 120_000)

  it(`A4: agent text output is reflected in the final history`, async () => {
    const entity = await t.spawn(TYPES.a4, `t-1`)
    await entity.send(`go`, { from: `user` })
    await entity.waitForTypeCount(`text_delta`, 1)
    await entity.waitForRun()

    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 60_000)

  it(`A5: multiple messages produce two completed runs`, async () => {
    const entity = await t.spawn(TYPES.a5, `m-1`)

    await entity.send(`msg 1`, { from: `user` })
    await entity.waitForRun()
    await entity.send(`msg 2`, { from: `user` })
    await entity.waitForRunCount(2)

    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`A5b: entity.waitForSettled returns the settled history without run-count polling`, async () => {
    const entity = await t.spawn(TYPES.a5, `m-settled-1`)

    await entity.send(`msg 1`, { from: `user` })
    await entity.waitForSettled()
    const history = await entity.waitForRunCount(1)

    expect(history.completedRunCount()).toBe(1)
    expect(history.count(`text_delta`)).toBe(1)
  }, 30_000)

  it(`A5c: t.waitForSettled waits for runtime quiescence`, async () => {
    const entity = await t.spawn(TYPES.a5, `m-settled-2`)

    await entity.send(`msg 1`, { from: `user` })
    await t.waitForSettled()
    await entity.waitForRunCount(1)

    expect((await entity.history()).completedRunCount()).toBe(1)
  }, 30_000)

  it(`A6: agent-less entity records only inbound messages`, async () => {
    const entity = await t.spawn(TYPES.a6, `na-1`)
    await entity.send(`hello`, { from: `user` })
    await entity.waitForTypeCount(`message_received`, 1)

    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`A7: setup state writes appear before the run history`, async () => {
    const entity = await t.spawn(TYPES.a7, `s-1`)
    await entity.send(`go`, { from: `user` })
    const history = await entity.waitForRun()

    expect(history.indexOf(`state:status`)).toBeLessThan(history.indexOf(`run`))
    expect(history.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`A8: manifest history includes the configured agent`, async () => {
    const entity = await t.spawn(TYPES.a8, `mf-1`)
    await entity.send(`go`, { from: `user` })
    await entity.waitForRun()

    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`A9: sync tool calls appear in-order within one completed run`, async () => {
    const entity = await t.spawn(TYPES.a9, `tool-sync-1`)
    await entity.send(`sync_echo hello tool`, { from: `user` })
    const history = await entity.waitForRun()

    expect(history.count(`tool_call`)).toBe(2)
    expect(history.indexOf(`run`)).toBeLessThan(history.indexOf(`tool_call`))
    expect(
      history.indexOf(
        `tool_call`,
        (event) => eventValueRecord(event)?.status === `started`
      )
    ).toBeLessThan(
      history.indexOf(
        `tool_call`,
        (event) => eventValueRecord(event)?.status === `completed`
      )
    )
    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`A10: async tool completion preserves a single clean run history`, async () => {
    const entity = await t.spawn(TYPES.a9, `tool-async-1`)
    await entity.send(`async_lookup widget-7`, { from: `user` })
    const history = await entity.waitForRun()

    expect(history.completedRunCount()).toBe(1)
    expect(
      history.count(
        `tool_call`,
        (event) => eventValueRecord(event)?.status === `completed`
      )
    ).toBe(1)
    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`A11: repeated tool calls keep ordering stable and use the last result`, async () => {
    const entity = await t.spawn(TYPES.a9, `tool-double-1`)
    await entity.send(`sync_echo first && sync_echo second`, { from: `user` })
    const history = await entity.waitForRun()

    expect(
      history.count(
        `tool_call`,
        (event) => eventValueRecord(event)?.status === `completed`
      )
    ).toBe(2)
    expect(history.find(`text_delta`)?.value).toMatchObject({
      delta: `sync_echo: second`,
    })
    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`A12: stateful note writes persist across wakes and can be read later`, async () => {
    const entity = await t.spawn(TYPES.a9, `tool-note-1`)
    await entity.send(`stateful_note write memo-1 first draft`, {
      from: `user`,
    })
    await entity.waitForRun()
    await entity.send(`stateful_note read memo-1`, { from: `user` })
    await entity.waitFor((streamHistory) =>
      streamHistory.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `stateful_note read: memo-1=first draft`
      )
    )
    const history = await entity.waitForRunCount(2)

    expect(history.count(`state:notes`)).toBe(1)
    expect(
      history.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `stateful_note read: memo-1=first draft`
      )?.value
    ).toMatchObject({
      delta: `stateful_note read: memo-1=first draft`,
    })
    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`A13: failing tools close the run cleanly with durable failure history`, async () => {
    const entity = await t.spawn(TYPES.a9, `tool-fail-1`)
    await entity.send(`fail_tool deterministic-boom`, { from: `user` })
    const history = await entity.waitForRun()

    expect(
      history.count(
        `tool_call`,
        (event) => eventValueRecord(event)?.status === `failed`
      )
    ).toBe(1)
    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`A14: an entity can recover from a failed tool call in a later run`, async () => {
    const entity = await t.spawn(TYPES.a9, `tool-recover-1`)
    await entity.send(`fail_tool deterministic-boom`, { from: `user` })
    await entity.waitForRun()

    await entity.send(`sync_echo recovered`, { from: `user` })
    const history = await entity.waitFor((stream) =>
      stream.some(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `sync_echo: recovered`
      )
    )

    expect(history.completedRunCount()).toBe(2)
    expect(
      history.find(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `sync_echo: recovered`
      )?.value
    ).toMatchObject({
      delta: `sync_echo: recovered`,
    })
    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)
})

describe(`B: spawn mechanics`, () => {
  it(`B1: spawn creates a child entity that can receive messages`, async () => {
    const parent = await t.spawn(TYPES.b1Parent, `p-1`)
    await parent.send(`go`, { from: `user` })
    await parent.waitForRun()

    const child = t.entity(`/${TYPES.b1Child}/c-1`)
    await child.send({ text: `hello child` }, { from: `parent` })
    await child.waitForTypeCount(`message_received`, 1)

    expect(await parent.snapshot()).toMatchSnapshot(`parent history`)
    expect(await child.snapshot()).toMatchSnapshot(`child history`)
  }, 30_000)

  it(`B2: spawn with initial message writes the child history`, async () => {
    const parent = await t.spawn(TYPES.b2Parent, `p-2`)
    await parent.send(`go`, { from: `user` })
    await parent.waitForRun()

    const child = t.entity(`/${TYPES.b2Child}/c-2`)
    await child.waitForTypeCount(`message_received`, 1)

    expect(await parent.snapshot()).toMatchSnapshot(`parent history`)
    expect(await child.snapshot()).toMatchSnapshot(`child history`)
  }, 30_000)

  it(`B3: spawn manifest history includes the resolved entityUrl`, async () => {
    const entity = await t.spawn(TYPES.b3Parent, `s-1`)
    await entity.send(`go`, { from: `user` })
    await entity.waitForRun()

    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`B4: spawn marks the child manifest row as observed`, async () => {
    const entity = await t.spawn(TYPES.b4Parent, `op-1`)
    await entity.send(`go`, { from: `user` })
    await entity.waitForRun()

    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)
})

describe(`C: state collections`, () => {
  it(`C1: ctx.state inserts are reflected in full stream history`, async () => {
    const entity = await t.spawn(TYPES.c1, `sw-1`)
    await entity.send(`go`, { from: `user` })
    await entity.waitForRun()

    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`C2: setup-initialized state remains visible in final history`, async () => {
    const entity = await t.spawn(TYPES.c2, `se-1`)
    await entity.send(`go`, { from: `user` })
    await entity.waitForRun()

    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`C3: self-authored state writes do not trigger a second run`, async () => {
    const entity = await t.spawn(TYPES.c3, `loop-1`)
    await entity.send(`save`, { from: `user` })
    const history = await entity.waitForRun()

    expect(history.count(`run`)).toBe(2)
    expect(
      history.find(
        `state:notes`,
        (event) => eventValueRecord(event)?.text === `saved`
      )?.value
    ).toMatchObject({
      text: `saved`,
    })
    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)
})

describe(`D: shared state`, () => {
  it(`D1: mkdb produces entity history with a manifest entry`, async () => {
    const entity = await t.spawn(TYPES.d1, `ssc-1`)
    await entity.send(`go`, { from: `user` })
    await entity.waitForRun()

    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`D2: shared state stream exists even before any writes`, async () => {
    const sharedState = t.sharedState(`ss-d2`)

    const entity = await t.spawn(TYPES.d2, `ssc-2`)
    await entity.send(`go`, { from: `user` })
    await entity.waitForRun()

    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
    expect(await sharedState.snapshot()).toMatchSnapshot(`shared state history`)
  }, 30_000)

  it(`D3: writes to shared state are reflected in both histories`, async () => {
    const sharedState = t.sharedState(`ss-d3`)

    const entity = await t.spawn(TYPES.d3, `ssw-1`)
    await entity.send(`write something`, { from: `user` })
    await entity.waitForRun()
    await sharedState.waitForTypeCount(`shared:article`, 1)

    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
    expect(await sharedState.snapshot()).toMatchSnapshot(`shared state history`)
  }, 30_000)

  it(`D4: a second entity can connect to existing shared state and read prior rows`, async () => {
    const sharedState = t.sharedState(`ss-d4`)

    const writer = await t.spawn(TYPES.d4, `ssc-4`, {
      sharedStateId: `ss-d4`,
    })
    await writer.send(`insert art-1 Alpha|First body`, { from: `user` })
    await writer.waitForRun()
    await sharedState.waitForTypeCount(`shared:article`, 1)

    const reader = await t.spawn(TYPES.d5, `ssr-4`, {
      sharedStateId: `ss-d4`,
    })
    await reader.send(`read art-1`, { from: `user` })
    const readerHistory = await reader.waitForRun()

    expect(
      readerHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta === `read:art-1:Alpha|First body`
      )?.value
    ).toMatchObject({
      delta: `read:art-1:Alpha|First body`,
    })
    const writerHistory = await writer.history()
    expect(
      writerHistory.events
        .filter((event) => event.type === `message_received`)
        .map((event) => eventValueRecord(event)?.payload)
    ).toEqual([`insert art-1 Alpha|First body`])
    expect(
      writerHistory.events
        .filter((event) => event.type === `text_delta`)
        .map((event) => eventValueRecord(event)?.delta)
    ).toEqual([`inserted:art-1:Alpha|First body`])
    expect(await reader.snapshot()).toMatchSnapshot(`reader history`)
    expect(await sharedState.snapshot()).toMatchSnapshot(`shared state history`)
  }, 30_000)

  it(`D5: shared state update and delete events remain durable across wakes`, async () => {
    const sharedState = t.sharedState(`ss-d5`)

    const writer = await t.spawn(TYPES.d4, `ssc-5`, {
      sharedStateId: `ss-d5`,
    })
    await writer.send(`insert art-1 Alpha|First body`, { from: `user` })
    await writer.waitForRun()
    await writer.send(`update art-1 Beta|Second body`, { from: `user` })
    await sharedState.waitForOperation(`shared:article`, `update`)
    await writer.send(`delete art-1`, { from: `user` })
    await sharedState.waitForOperation(`shared:article`, `delete`)
    const sharedHistory = await sharedState.waitForTypeCount(
      `shared:article`,
      3
    )

    const reader = await t.spawn(TYPES.d5, `ssr-5`, {
      sharedStateId: `ss-d5`,
    })
    await reader.send(`read art-1`, { from: `user` })
    const readerHistory = await reader.waitForRun()

    expect(
      sharedHistory.count(
        `shared:article`,
        (event) =>
          eventValueRecord({ value: event.headers })?.operation === `insert`
      )
    ).toBe(1)
    expect(
      sharedHistory.count(
        `shared:article`,
        (event) =>
          eventValueRecord({ value: event.headers })?.operation === `update`
      )
    ).toBe(1)
    expect(
      sharedHistory.count(
        `shared:article`,
        (event) =>
          eventValueRecord({ value: event.headers })?.operation === `delete`
      )
    ).toBe(1)
    expect(
      readerHistory.find(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `read:art-1:<missing>`
      )?.value
    ).toMatchObject({
      delta: `read:art-1:<missing>`,
    })
    const writerHistory = await writer.history()
    expect(
      writerHistory.events
        .filter((event) => event.type === `message_received`)
        .map((event) => eventValueRecord(event)?.payload)
    ).toEqual([
      `insert art-1 Alpha|First body`,
      `update art-1 Beta|Second body`,
      `delete art-1`,
    ])
    expect(
      writerHistory.events
        .filter((event) => event.type === `text_delta`)
        .map((event) => eventValueRecord(event)?.delta)
    ).toEqual([
      `inserted:art-1:Alpha|First body`,
      `updated:art-1:Beta|Second body`,
      `deleted:art-1`,
    ])
    expect(await reader.snapshot()).toMatchSnapshot(`reader history`)
    expect(await sharedState.snapshot()).toMatchSnapshot(`shared state history`)
  }, 30_000)

  it(`D6: multi-collection shared state stays consistent across writer and reader entities`, async () => {
    const sharedState = t.sharedState(`ss-d6`)

    const writer = await t.spawn(TYPES.d6Writer, `ssw-6`, {
      sharedStateId: `ss-d6`,
    })
    await writer.send(
      `write_article art-1 Alpha|First body && write_comment c-1 art-1|Looks good`,
      {
        from: `user`,
      }
    )
    await writer.waitForRun()
    await sharedState.waitFor((history) => {
      return (
        history.count(`shared:article`) === 1 &&
        history.count(`shared:comment`) === 1
      )
    })

    const reader = await t.spawn(TYPES.d6Reader, `ssr-6`, {
      sharedStateId: `ss-d6`,
    })
    await reader.send(`summary`, { from: `user` })
    const readerHistory = await reader.waitForRun()

    expect(
      readerHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `articles:1;comments:1;art-1:Alpha[Looks good]`
      )?.value
    ).toMatchObject({
      delta: `articles:1;comments:1;art-1:Alpha[Looks good]`,
    })
    expect(await writer.snapshot()).toMatchSnapshot(`writer history`)
    expect(await reader.snapshot()).toMatchSnapshot(`reader history`)
    expect(await sharedState.snapshot()).toMatchSnapshot(`shared state history`)
  }, 30_000)

  it(`D7: multiple entities can contribute durable rows to the same shared collection`, async () => {
    const sharedState = t.sharedState(`ss-d7`)

    const writerA = await t.spawn(TYPES.d4, `ssw-7a`, {
      sharedStateId: `ss-d7`,
    })
    const writerB = await t.spawn(TYPES.d4, `ssw-7b`, {
      sharedStateId: `ss-d7`,
    })

    await writerA.send(`insert art-1 Alpha|First body`, { from: `user` })
    await writerA.waitForRun()
    await writerB.send(`insert art-2 Beta|Second body`, { from: `user` })
    await writerB.waitForRun()
    await sharedState.waitForTypeCount(`shared:article`, 2)

    const reader = await t.spawn(TYPES.d5, `ssr-7`, {
      sharedStateId: `ss-d7`,
    })
    await reader.send(`count`, { from: `user` })
    const readerHistory = await reader.waitForRun()

    expect(
      readerHistory.find(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `count:2`
      )?.value
    ).toMatchObject({
      delta: `count:2`,
    })
    expect(await writerA.snapshot()).toMatchSnapshot(`writer A history`)
    expect(await writerB.snapshot()).toMatchSnapshot(`writer B history`)
    expect(await reader.snapshot()).toMatchSnapshot(`reader history`)
    expect(await sharedState.snapshot()).toMatchSnapshot(`shared state history`)
  }, 30_000)

  it(`D8: a later writer can overwrite a shared row and a new reader sees the latest value`, async () => {
    const sharedState = t.sharedState(`ss-d8`)

    const writerA = await t.spawn(TYPES.d4, `ssw-8a`, {
      sharedStateId: `ss-d8`,
    })
    const writerB = await t.spawn(TYPES.d4, `ssw-8b`, {
      sharedStateId: `ss-d8`,
    })

    await writerA.send(`insert art-1 Alpha|First body`, { from: `user` })
    await writerA.waitForRun()
    await writerB.send(`update art-1 Beta|Second body`, { from: `user` })
    await writerB.waitForRun()
    const sharedHistory = await sharedState.waitForTypeCount(
      `shared:article`,
      2
    )

    const reader = await t.spawn(TYPES.d5, `ssr-8`, {
      sharedStateId: `ss-d8`,
    })
    await reader.send(`read art-1`, { from: `user` })
    const readerHistory = await reader.waitForRun()

    expect(
      sharedHistory.count(
        `shared:article`,
        (event) =>
          eventValueRecord({ value: event.headers })?.operation === `insert`
      )
    ).toBe(1)
    expect(
      sharedHistory.count(
        `shared:article`,
        (event) =>
          eventValueRecord({ value: event.headers })?.operation === `update`
      )
    ).toBe(1)
    expect(
      readerHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta === `read:art-1:Beta|Second body`
      )?.value
    ).toMatchObject({
      delta: `read:art-1:Beta|Second body`,
    })
    expect(await writerA.snapshot()).toMatchSnapshot(`writer A history`)
    expect(await writerB.snapshot()).toMatchSnapshot(`writer B history`)
    expect(await reader.snapshot()).toMatchSnapshot(`reader history`)
    expect(await sharedState.snapshot()).toMatchSnapshot(`shared state history`)
  }, 30_000)

  it(`D9: a setup-registered shared-state effect fires on the first wake write and survives a later wake`, async () => {
    const sharedState = t.sharedState(`ss-d9`)

    const entity = await t.spawn(
      TYPES.d9,
      `sse-9`,
      { sharedStateId: `ss-d9` },
      { initialMessage: `insert art-1 Alpha|First body` }
    )

    const entityHistory = await entity.waitFor((history) => {
      return history.some(
        `state:notice`,
        (event) => eventValueRecord(event)?.text === `noticed:Alpha`
      )
    })
    await sharedState.waitForTypeCount(`shared:article`, 1)

    expect(
      entityHistory.find(
        `state:notice`,
        (event) => eventValueRecord(event)?.text === `noticed:Alpha`
      )?.value
    ).toMatchObject({
      text: `noticed:Alpha`,
    })
    await entity.send(`read art-1`, { from: `user` })
    const rereadHistory = await entity.waitFor((history) => {
      return history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta === `read:art-1:Alpha|First body`
      )
    })
    expect(
      rereadHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta === `read:art-1:Alpha|First body`
      )?.value
    ).toMatchObject({
      delta: `read:art-1:Alpha|First body`,
    })
    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
    expect(await sharedState.snapshot()).toMatchSnapshot(`shared state history`)
  }, 30_000)

  it(`D10: separate entities can contribute to different collections in one shared state`, async () => {
    const sharedState = t.sharedState(`ss-d10`)

    const writerA = await t.spawn(TYPES.d6Writer, `ssw-10a`, {
      sharedStateId: `ss-d10`,
    })
    const writerB = await t.spawn(TYPES.d6Writer, `ssw-10b`, {
      sharedStateId: `ss-d10`,
    })

    await writerA.send(`write_article art-1 Alpha|First body`, {
      from: `user`,
    })
    await writerA.waitForRun()
    await writerB.send(`write_comment c-1 art-1|Looks good`, {
      from: `user`,
    })
    await writerB.waitForRun()
    await sharedState.waitFor((history) => {
      return (
        history.count(`shared:article`) === 1 &&
        history.count(`shared:comment`) === 1
      )
    })

    const reader = await t.spawn(TYPES.d6Reader, `ssr-10`, {
      sharedStateId: `ss-d10`,
    })
    await reader.send(`summary`, { from: `user` })
    const readerHistory = await reader.waitForRun()

    expect(
      readerHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `articles:1;comments:1;art-1:Alpha[Looks good]`
      )?.value
    ).toMatchObject({
      delta: `articles:1;comments:1;art-1:Alpha[Looks good]`,
    })
    expect(await writerA.snapshot()).toMatchSnapshot(`writer A history`)
    expect(await writerB.snapshot()).toMatchSnapshot(`writer B history`)
    expect(await reader.snapshot()).toMatchSnapshot(`reader history`)
    expect(await sharedState.snapshot()).toMatchSnapshot(`shared state history`)
  }, 30_000)

  it(`D11: adjacent writers contending on the same shared key preserve full history and last-write-wins`, async () => {
    const sharedState = t.sharedState(`ss-d11`)

    const writerA = await t.spawn(TYPES.d4, `ssw-11a`, {
      sharedStateId: `ss-d11`,
    })
    const writerB = await t.spawn(TYPES.d4, `ssw-11b`, {
      sharedStateId: `ss-d11`,
    })

    await writerA.send(`insert art-1 Alpha|First body`, { from: `user` })
    await writerA.waitForRun()
    await writerB.send(`update art-1 Beta|Second body`, { from: `user` })
    await writerB.waitForRun()
    await writerA.send(`update art-1 Gamma|Third body`, { from: `user` })

    const sharedHistory = await sharedState.waitForTypeCount(
      `shared:article`,
      3
    )

    const reader = await t.spawn(TYPES.d5, `ssr-11`, {
      sharedStateId: `ss-d11`,
    })
    await reader.send(`read art-1`, { from: `user` })
    const readerHistory = await reader.waitForRun()

    expect(
      sharedHistory.count(
        `shared:article`,
        (event) =>
          eventValueRecord({ value: event.headers })?.operation === `insert`
      )
    ).toBe(1)
    expect(
      sharedHistory.count(
        `shared:article`,
        (event) =>
          eventValueRecord({ value: event.headers })?.operation === `update`
      )
    ).toBe(2)
    expect(
      readerHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta === `read:art-1:Gamma|Third body`
      )?.value
    ).toMatchObject({
      delta: `read:art-1:Gamma|Third body`,
    })
  }, 30_000)

  it(`D12: mutating one shared collection does not disturb reads from another collection`, async () => {
    const sharedState = t.sharedState(`ss-d12`)

    const articleWriter = await t.spawn(TYPES.d6Writer, `ssw-12a`, {
      sharedStateId: `ss-d12`,
    })
    const commentWriter = await t.spawn(TYPES.d6Writer, `ssw-12b`, {
      sharedStateId: `ss-d12`,
    })
    const reader = await t.spawn(TYPES.d6Reader, `ssr-12`, {
      sharedStateId: `ss-d12`,
    })

    await articleWriter.send(`write_article art-1 Alpha|First body`, {
      from: `user`,
    })
    await articleWriter.waitForRun()
    await sharedState.waitForTypeCount(`shared:article`, 1)

    await reader.send(`summary`, { from: `user` })
    const firstSummary = await reader.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `articles:1;comments:0;art-1:Alpha[none]`
      )
    )

    await commentWriter.send(`write_comment c-1 art-1|Looks good`, {
      from: `user`,
    })
    await commentWriter.waitForRun()
    await sharedState.waitFor((history) => {
      return (
        history.count(`shared:article`) === 1 &&
        history.count(`shared:comment`) === 1
      )
    })

    await reader.send(`summary`, { from: `user` })
    const secondSummary = await reader.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `articles:1;comments:1;art-1:Alpha[Looks good]`
      )
    )

    expect(
      firstSummary.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `articles:1;comments:0;art-1:Alpha[none]`
      )?.value
    ).toMatchObject({
      delta: `articles:1;comments:0;art-1:Alpha[none]`,
    })
    expect(
      secondSummary.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `articles:1;comments:1;art-1:Alpha[Looks good]`
      )?.value
    ).toMatchObject({
      delta: `articles:1;comments:1;art-1:Alpha[Looks good]`,
    })
  }, 30_000)
})

describe(`E: observation replay`, () => {
  it(`E0: observe without wake does not re-wake on later child writes`, async () => {
    const child = await t.spawn(TYPES.e1Child, `child-0`)
    const parent = await t.spawn(TYPES.e1Parent, `parent-0`, {
      childUrl: child.entityUrl,
    })

    await parent.send(`poke-0`, { from: `user` })
    const initialHistory = await parent.waitForRun()
    const initialRunCount = initialHistory.completedRunCount()

    await child.send(`insert item-1 alpha`, { from: `user` })
    await child.waitForOperation(`observed_item`, `insert`)
    await t.waitForSettled()

    const postChildWriteHistory = await parent.history()
    expect(postChildWriteHistory.completedRunCount()).toBe(initialRunCount)
    expect(postChildWriteHistory.count(`observed_count`)).toBe(0)

    await parent.send(`poke-1`, { from: `user` })
    const parentHistory = await parent.waitForTypeCount(`observed_count`, 1)

    expect(parentHistory.find(`observed_count`)?.value).toMatchObject({
      key: `item-1`,
      count: 1,
    })
  }, 30_000)

  it(`E1: observed effects do not duplicate old child rows after parent re-wake`, async () => {
    const child = await t.spawn(TYPES.e1Child, `child-1`)
    const parent = await t.spawn(TYPES.e1Parent, `parent-1`, {
      childUrl: child.entityUrl,
    })

    await parent.send(`poke-0`, { from: `user` })
    await parent.waitForRun()

    await child.send(`insert item-1 alpha`, { from: `user` })
    await child.waitForOperation(`observed_item`, `insert`)
    await parent.send(`poke-1`, { from: `user` })
    await parent.waitForTypeCount(`observed_count`, 1)

    await parent.send(`poke-2`, { from: `user` })
    await parent.waitFor((history) =>
      history.some(
        `message_received`,
        (event) => eventValueRecord(event)?.payload === `poke-2`
      )
    )

    const postReplayHistory = await parent.history()
    expect(postReplayHistory.count(`observed_count`)).toBe(1)
    expect(postReplayHistory.find(`observed_count`)?.value).toMatchObject({
      key: `item-1`,
      count: 1,
    })

    await child.send(`insert item-2 beta`, { from: `user` })
    await child.waitForOperation(`observed_item`, `insert`, { count: 2 })
    await parent.send(`poke-3`, { from: `user` })
    const parentHistory = await parent.waitForTypeCount(`observed_count`, 2)

    expect(parentHistory.count(`observed_count`)).toBe(2)
    expect(await child.snapshot()).toMatchSnapshot(`child history`)
    expect({
      userPayloads: parentHistory.events
        .filter((event) => event.type === `message_received`)
        .map((event) => eventValueRecord(event)?.payload),
      observedCounts: parentHistory.events
        .filter((event) => event.type === `observed_count`)
        .map((event) => eventValueRecord(event)),
    }).toMatchSnapshot(`parent history`)
  }, 30_000)

  it(`E2: updating an observed row preserves a single derived row key`, async () => {
    const child = await t.spawn(TYPES.e1Child, `child-2`)
    const parent = await t.spawn(TYPES.e2Parent, `parent-2`, {
      childUrl: child.entityUrl,
    })

    await parent.send(`poke-0`, { from: `user` })
    await parent.waitForRun()

    await child.send(`insert item-1 alpha`, { from: `user` })
    await child.waitForRun()
    await parent.send(`poke-1`, { from: `user` })
    await parent.waitForTypeCount(`mirrored_item`, 1)

    await child.send(`update item-1 beta`, { from: `user` })
    await child.waitForOperation(`observed_item`, `update`)
    await parent.send(`poke-2`, { from: `user` })
    const parentHistory = await parent.waitFor(
      (history) =>
        history.count(
          `mirrored_item`,
          (event) =>
            eventValueRecord({ value: event.headers })?.operation === `update`
        ) >= 1,
      30_000
    )

    expect(
      parentHistory.count(
        `mirrored_item`,
        (event) =>
          eventValueRecord({ value: event.headers })?.operation === `insert`
      )
    ).toBe(1)
    expect(
      new Set(
        parentHistory.events
          .filter((event) => event.type === `mirrored_item`)
          .map((event) => String(eventValueRecord(event)?.key ?? ``))
      )
    ).toEqual(new Set([`item-1`]))
    expect(
      parentHistory.events
        .filter((event) => event.type === `mirrored_item`)
        .at(-1)?.value
    ).toMatchObject({
      key: `item-1`,
      value: `beta`,
    })
    expect(await child.snapshot()).toMatchSnapshot(`child history`)
    expect(
      parentHistory.filteredSnapshot((entry) => entry.type === `mirrored_item`)
    ).toMatchSnapshot(`parent history`)
  }, 30_000)

  it(`E3: an observed row update is replayed as an update, not a second insert`, async () => {
    const child = await t.spawn(TYPES.e1Child, `child-3`)
    const parent = await t.spawn(TYPES.e2Parent, `parent-3`, {
      childUrl: child.entityUrl,
    })

    await parent.send(`poke-0`, { from: `user` })
    await parent.waitForRun()

    await child.send(`insert item-1 alpha`, { from: `user` })
    await child.waitForRun()
    await parent.send(`poke-1`, { from: `user` })
    await parent.waitForTypeCount(`mirrored_item`, 1)

    await child.send(`update item-1 beta`, { from: `user` })
    await child.waitForOperation(`observed_item`, `update`)
    await parent.send(`poke-2`, { from: `user` })
    const parentHistory = await parent.waitFor(
      (history) =>
        history.count(
          `mirrored_item`,
          (event) =>
            eventValueRecord({ value: event.headers })?.operation === `update`
        ) >= 1,
      30_000
    )

    expect(
      parentHistory.count(
        `mirrored_item`,
        (event) =>
          eventValueRecord({ value: event.headers })?.operation === `insert`
      )
    ).toBe(1)
    expect(
      parentHistory.count(
        `mirrored_item`,
        (event) =>
          eventValueRecord({ value: event.headers })?.operation === `update`
      )
    ).toBeGreaterThanOrEqual(1)
    expect(
      parentHistory.events
        .filter((event) => event.type === `mirrored_item`)
        .at(-1)?.value
    ).toMatchObject({
      key: `item-1`,
      value: `beta`,
    })
    expect(await child.snapshot()).toMatchSnapshot(`child history`)
    expect(
      parentHistory.filteredSnapshot((entry) => entry.type === `mirrored_item`)
    ).toMatchSnapshot(`parent history`)
  }, 30_000)
})

describe(`F: coordination orchestration`, () => {
  it(`F1: dispatcher routes to the requested specialist type and records the child`, async () => {
    const parent = await t.spawn(TYPES.f1Dispatcher, `dispatch-1`)
    await parent.send(`dispatch assistant hello routing`, { from: `user` })
    const parentHistory = await parent.waitForRun()

    const child = t.entity(`/${TYPES.f1AssistantChild}/dispatch-1-dispatch-1`)
    await child.waitForRun()

    expect(
      parentHistory.find(
        `state:children`,
        (event) => eventValueRecord(event)?.kind === `assistant`
      )?.value
    ).toMatchObject({
      key: `dispatch-1-dispatch-1`,
      kind: `assistant`,
    })
    expect(
      (await parent.snapshot()).filter((entry) => entry.type !== `state:status`)
    ).toMatchSnapshot(`parent history`)
    expect(await child.snapshot()).toMatchSnapshot(`child history`)
  }, 30_000)

  it(`F2: manager-worker spawns, observes, and later collects all perspectives in a stable order`, async () => {
    const parent = await t.spawn(TYPES.f2Manager, `manager-1`)
    await parent.send(`spawn_perspectives Should we ship the feature?`, {
      from: `user`,
    })
    await parent.waitForRun()
    await parent.waitForTypeCount(`child_status`, 3)
    await parent.waitForSettled(60_000)

    await parent.send(`wait_for_all`, { from: `user` })
    const expectedDelta =
      `optimist:optimist::Should we ship the feature? | ` +
      `pessimist:pessimist::Should we ship the feature? | ` +
      `pragmatist:pragmatist::Should we ship the feature?`
    const parentHistory = await parent.waitFor((history) => {
      const currentStatuses = history.events
        .filter((event) => event.type === `state:status`)
        .map((event) => eventValueRecord(event))
        .filter(
          (
            value
          ): value is {
            key: string
            value: string
          } =>
            value !== undefined &&
            typeof value.key === `string` &&
            typeof value.value === `string`
        )
        .filter((value) => value.key === `current`)
      const lastCurrentStatus = currentStatuses[currentStatuses.length - 1]

      return (
        history.some(
          `text_delta`,
          (event) => eventValueRecord(event)?.delta === expectedDelta
        ) && lastCurrentStatus?.value === `idle`
      )
    })

    const optimist = t.entity(`/${TYPES.fCoordWorker}/manager-1-optimist`)
    const pessimist = t.entity(`/${TYPES.fCoordWorker}/manager-1-pessimist`)
    const pragmatist = t.entity(`/${TYPES.fCoordWorker}/manager-1-pragmatist`)
    await optimist.waitForRun()
    await pessimist.waitForRun()
    await pragmatist.waitForRun()

    expect(
      new Map(
        parentHistory.events
          .filter((event) => event.type === `child_status`)
          .map((event) => {
            const value = eventValueRecord(event)
            return [
              String(value?.key ?? ``),
              String(value?.status ?? ``),
            ] as const
          })
      ).size
    ).toBe(3)
    expect(
      parentHistory.find(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === expectedDelta
      )?.value
    ).toMatchObject({
      delta: expectedDelta,
    })
    expect(
      parentHistory
        .filteredSnapshot((entry) => {
          if (
            entry.type === `entity_created` ||
            entry.type === `message_received` ||
            entry.type === `tool_call` ||
            entry.type === `state:children`
          ) {
            return true
          }

          if (entry.type === `state:status`) {
            const value = eventValueRecord({ value: entry.value })
            return value?.value !== undefined
          }

          if (entry.type === `text_delta`) {
            return entry.delta === expectedDelta
          }

          return false
        })
        .map((entry) =>
          entry.type === `text_delta`
            ? {
                type: entry.type,
                delta: entry.delta,
              }
            : entry
        )
    ).toMatchSnapshot(`parent history`)
    expect(await optimist.snapshot()).toMatchSnapshot(`optimist history`)
    expect(await pessimist.snapshot()).toMatchSnapshot(`pessimist history`)
    expect(await pragmatist.snapshot()).toMatchSnapshot(`pragmatist history`)
  }, 60_000)

  it(`F3: dispatcher increments dispatch count and keeps both child rows across wakes`, async () => {
    const parent = await t.spawn(TYPES.f1Dispatcher, `dispatch-2`)

    await parent.send(`dispatch assistant first task`, { from: `user` })
    await parent.waitForRun()

    await parent.send(`dispatch worker second task`, { from: `user` })
    const parentHistory = await parent.waitFor((history) => {
      const counter = history.find(
        `state:counters`,
        (event) =>
          eventValueRecord(event)?.key === `dispatchCount` &&
          eventValueRecord(event)?.value === 2
      )
      return (
        !!counter &&
        history.count(
          `state:children`,
          (event) => !!eventValueRecord(event)?.url
        ) >= 2
      )
    })

    expect(
      parentHistory.find(
        `state:counters`,
        (event) =>
          eventValueRecord(event)?.key === `dispatchCount` &&
          eventValueRecord(event)?.value === 2
      )?.value
    ).toMatchObject({
      key: `dispatchCount`,
      value: 2,
    })
    expect(
      parentHistory.count(
        `state:children`,
        (event) => !!eventValueRecord(event)?.url
      )
    ).toBe(2)
    expect(
      parentHistory.count(
        `state:children`,
        (event) => eventValueRecord(event)?.kind === `assistant`
      )
    ).toBe(1)
    expect(
      parentHistory.count(
        `state:children`,
        (event) => eventValueRecord(event)?.kind === `worker`
      )
    ).toBe(1)
  }, 30_000)

  it(`F4: dispatcher records the expected status progression during a dispatch`, async () => {
    const parent = await t.spawn(TYPES.f1Dispatcher, `dispatch-3`)
    await parent.send(`dispatch assistant status please`, { from: `user` })
    const expectedStatuses = [
      `idle`,
      `classifying`,
      `dispatching`,
      `waiting`,
      `idle`,
    ]
    const parentHistory = await parent.waitFor((history) => {
      const statuses = history.events
        .filter((event) => event.type === `state:status`)
        .map((event) => eventValueRecord(event)?.value)
        .filter((value): value is string => typeof value === `string`)

      return (
        statuses.length >= expectedStatuses.length &&
        expectedStatuses.every((status, index) => statuses[index] === status)
      )
    })

    const statuses = parentHistory.events
      .filter((event) => event.type === `state:status`)
      .map((event) => eventValueRecord(event)?.value)
      .filter((value): value is string => typeof value === `string`)

    expect(statuses.slice(0, expectedStatuses.length)).toEqual(expectedStatuses)
  }, 30_000)

  it(`F5: dispatcher returns the documented placeholder when a child produces no text`, async () => {
    const parent = await t.spawn(TYPES.f1Dispatcher, `dispatch-4`)
    await parent.send(`dispatch assistant __silent__`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `(no text output)`
      )
    )

    const child = t.entity(`/${TYPES.f1AssistantChild}/dispatch-4-dispatch-1`)
    const childHistory = await child.waitForRun()

    expect(
      parentHistory.find(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `(no text output)`
      )?.value
    ).toMatchObject({
      delta: `(no text output)`,
    })
    expect(childHistory.count(`text_delta`)).toBe(0)
  }, 30_000)

  it(`F6: wait_for_all before spawning perspectives returns the documented error path`, async () => {
    const parent = await t.spawn(TYPES.f2Manager, `manager-2`)
    await parent.send(`wait_for_all`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `No perspective agents have been spawned yet.`
      )
    )

    expect(
      parentHistory.find(
        `tool_call`,
        (event) =>
          eventValueRecord(event)?.tool_name === `wait_for_all` &&
          eventValueRecord(event)?.status === `failed`
      )?.value
    ).toMatchObject({
      tool_name: `wait_for_all`,
      status: `failed`,
    })
    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `No perspective agents have been spawned yet.`
      )?.value
    ).toMatchObject({
      delta: `No perspective agents have been spawned yet.`,
    })
  }, 30_000)

  it(`F7: manager-worker uses placeholders when every perspective child is silent`, async () => {
    const parent = await t.spawn(TYPES.f2Manager, `manager-3`)
    await parent.send(`spawn_perspectives __silent__`, { from: `user` })
    await parent.waitForRun()
    await parent.waitForTypeCount(`child_status`, 3)
    await parent.waitForSettled(60_000)

    await parent.send(`wait_for_all`, { from: `user` })
    const parentHistory = await parent.waitFor(
      (history) =>
        history.some(
          `text_delta`,
          (event) =>
            eventValueRecord(event)?.delta ===
            `optimist:(no text output) | pessimist:(no text output) | pragmatist:(no text output)`
        ),
      60_000
    )

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `optimist:(no text output) | pessimist:(no text output) | pragmatist:(no text output)`
      )?.value
    ).toMatchObject({
      delta:
        `optimist:(no text output) | ` +
        `pessimist:(no text output) | ` +
        `pragmatist:(no text output)`,
    })
  }, 60_000)

  it(`F8: repeated spawn_perspectives reuses the same child streams for later questions`, async () => {
    const parent = await t.spawn(TYPES.f2Manager, `manager-4`)
    const optimist = t.entity(`/${TYPES.fCoordWorker}/manager-4-optimist`)
    const pessimist = t.entity(`/${TYPES.fCoordWorker}/manager-4-pessimist`)
    const pragmatist = t.entity(`/${TYPES.fCoordWorker}/manager-4-pragmatist`)

    await parent.send(`spawn_perspectives first question`, { from: `user` })
    await parent.waitForRun()
    await parent.waitForTypeCount(`child_status`, 3)
    await parent.waitForSettled(60_000)

    await parent.send(`spawn_perspectives second question`, { from: `user` })

    const secondOptimist = await optimist.waitFor(
      (history) => history.count(`message_received`) >= 2,
      60_000
    )
    const secondPessimist = await pessimist.waitFor(
      (history) => history.count(`message_received`) >= 2,
      60_000
    )
    const secondPragmatist = await pragmatist.waitFor(
      (history) => history.count(`message_received`) >= 2,
      60_000
    )
    const parentHistory = await parent.waitFor((history) => {
      const childUrls = new Set(
        history.events
          .filter((event) => event.type === `state:children`)
          .map((event) => String(eventValueRecord(event)?.url ?? ``))
          .filter(Boolean)
      )
      return childUrls.size === 3
    }, 60_000)
    await Promise.all([
      optimist.waitForRunCount(2),
      pessimist.waitForRunCount(2),
      pragmatist.waitForRunCount(2),
    ])
    await t.waitForSettled()

    expect(secondOptimist.count(`entity_created`)).toBe(1)
    expect(secondPessimist.count(`entity_created`)).toBe(1)
    expect(secondPragmatist.count(`entity_created`)).toBe(1)
    expect(secondOptimist.count(`message_received`)).toBe(2)
    expect(secondPessimist.count(`message_received`)).toBe(2)
    expect(secondPragmatist.count(`message_received`)).toBe(2)
    expect(
      new Set(
        parentHistory.events
          .filter((event) => event.type === `state:children`)
          .map((event) => String(eventValueRecord(event)?.url ?? ``))
          .filter(Boolean)
      ).size
    ).toBe(3)
  }, 60_000)

  it(`F9: manager-worker records a targeted child failure and uses a placeholder only for that perspective`, async () => {
    const parent = await t.spawn(TYPES.f2Manager, `manager-5`)
    t.expectWakeError(`deterministic failure for pessimist`)

    await parent.send(
      `spawn_perspectives __fail__:pessimist Should we ship the feature?`,
      {
        from: `user`,
      }
    )
    const spawnHistory = await parent.waitFor((history) => {
      const statuses = new Map(
        history.events
          .filter((event) => event.type === `child_status`)
          .map((event) => {
            const value = eventValueRecord(event)
            return [
              String(value?.key ?? ``),
              String(value?.status ?? ``),
            ] as const
          })
      )
      return (
        statuses.get(`optimist`) === `completed` &&
        statuses.get(`pessimist`) === `failed` &&
        statuses.get(`pragmatist`) === `completed`
      )
    })
    await parent.waitForSettled(60_000)

    await parent.send(`wait_for_all`, { from: `user` })
    const expectedDelta =
      `optimist:optimist::Should we ship the feature? | ` +
      `pessimist:(no text output) | ` +
      `pragmatist:pragmatist::Should we ship the feature?`
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === expectedDelta
      )
    )

    expect(
      new Map(
        spawnHistory.events
          .filter((event) => event.type === `child_status`)
          .map((event) => {
            const value = eventValueRecord(event)
            return [
              String(value?.key ?? ``),
              String(value?.status ?? ``),
            ] as const
          })
      )
    ).toEqual(
      new Map([
        [`optimist`, `completed`],
        [`pessimist`, `failed`],
        [`pragmatist`, `completed`],
      ])
    )
    expect(
      parentHistory.find(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === expectedDelta
      )?.value
    ).toMatchObject({
      delta: expectedDelta,
    })
  }, 60_000)

  it(`F10: manager-worker can retry after a targeted failure and later collect full results`, async () => {
    const parent = await t.spawn(TYPES.f2Manager, `manager-6`)
    t.expectWakeError(`deterministic failure for pessimist`)
    const pessimist = t.entity(`/${TYPES.fCoordWorker}/manager-6-pessimist`)

    await parent.send(
      `spawn_perspectives __fail__:pessimist Should we ship the feature?`,
      {
        from: `user`,
      }
    )
    await parent.waitFor((history) => {
      const statuses = new Map(
        history.events
          .filter((event) => event.type === `child_status`)
          .map((event) => {
            const value = eventValueRecord(event)
            return [
              String(value?.key ?? ``),
              String(value?.status ?? ``),
            ] as const
          })
      )
      return statuses.get(`pessimist`) === `failed`
    })
    await parent.send(`spawn_perspectives Should we ship the feature?`, {
      from: `user`,
    })
    await pessimist.waitFor((history) => {
      const runs = history.events
        .filter((event) => event.type === `run`)
        .map((event) => eventValueRecord(event))
        .filter((value): value is Record<string, unknown> => Boolean(value))

      const terminalStatuses = runs
        .filter((value) => {
          const status = String(value.status ?? ``)
          return status === `failed` || status === `completed`
        })
        .map((value) => String(value.status))

      return (
        terminalStatuses.length >= 2 &&
        terminalStatuses.includes(`failed`) &&
        terminalStatuses.includes(`completed`)
      )
    }, 60_000)
    await parent.waitFor((history) => {
      const statuses = new Map(
        history.events
          .filter((event) => event.type === `child_status`)
          .map((event) => {
            const value = eventValueRecord(event)
            return [
              String(value?.key ?? ``),
              String(value?.status ?? ``),
            ] as const
          })
      )
      return statuses.get(`pessimist`) === `completed`
    })
    await parent.send(`wait_for_all`, { from: `user` })
    const expectedDelta =
      `optimist:optimist::Should we ship the feature? | ` +
      `pessimist:pessimist::Should we ship the feature? | ` +
      `pragmatist:pragmatist::Should we ship the feature?`
    const parentHistory = await parent.waitFor((history) => {
      const statuses = new Map(
        history.events
          .filter((event) => event.type === `child_status`)
          .map((event) => {
            const value = eventValueRecord(event)
            return [
              String(value?.key ?? ``),
              String(value?.status ?? ``),
            ] as const
          })
      )
      return (
        statuses.get(`optimist`) === `completed` &&
        statuses.get(`pessimist`) === `completed` &&
        statuses.get(`pragmatist`) === `completed` &&
        history.some(
          `text_delta`,
          (event) => eventValueRecord(event)?.delta === expectedDelta
        )
      )
    })

    expect(
      parentHistory.find(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === expectedDelta
      )?.value
    ).toMatchObject({
      delta: expectedDelta,
    })
  }, 60_000)

  it(`F11: dispatcher preserves counters and child rows when a specialist fails`, async () => {
    const parent = await t.spawn(TYPES.f1Dispatcher, `dispatch-11`)
    t.expectWakeError(`deterministic failure for worker`)

    await parent.send(
      `dispatch worker __fail__:worker Investigate the outage`,
      {
        from: `user`,
      }
    )
    const parentHistory = await parent.waitFor((history) => {
      const countRow = history.find(
        `state:counters`,
        (event) => eventValueRecord(event)?.key === `dispatchCount`
      )
      const childRow = history.find(
        `state:children`,
        (event) => eventValueRecord(event)?.key === `dispatch-11-dispatch-1`
      )
      return (
        eventValueRecord(countRow)?.value === 1 &&
        eventValueRecord(childRow)?.url ===
          `/${TYPES.f1WorkerChild}/dispatch-11-dispatch-1` &&
        history.some(
          `text_delta`,
          (event) => eventValueRecord(event)?.delta === `(no text output)`
        )
      )
    })

    const child = t.entity(`/${TYPES.f1WorkerChild}/dispatch-11-dispatch-1`)
    const childHistory = await child.waitFor((history) =>
      history.some(
        `error`,
        (event) =>
          eventValueRecord(event)?.message ===
          `deterministic failure for worker`
      )
    )

    expect(
      parentHistory.find(
        `state:counters`,
        (event) => eventValueRecord(event)?.key === `dispatchCount`
      )?.value
    ).toMatchObject({
      key: `dispatchCount`,
      value: 1,
    })
    expect(
      parentHistory.find(
        `state:children`,
        (event) => eventValueRecord(event)?.key === `dispatch-11-dispatch-1`
      )?.value
    ).toMatchObject({
      key: `dispatch-11-dispatch-1`,
      url: `/${TYPES.f1WorkerChild}/dispatch-11-dispatch-1`,
      kind: `worker`,
    })
    expect(
      parentHistory.find(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `(no text output)`
      )?.value
    ).toMatchObject({
      delta: `(no text output)`,
    })
    expect(
      childHistory.find(
        `error`,
        (event) =>
          eventValueRecord(event)?.message ===
          `deterministic failure for worker`
      )?.value
    ).toMatchObject({
      message: `deterministic failure for worker`,
    })
  }, 30_000)

  it(`F12: dispatcher preserves counters and child rows across repeated failing dispatches`, async () => {
    const parent = await t.spawn(TYPES.f1Dispatcher, `dispatch-12`)
    t.expectWakeError(`deterministic failure for worker`)
    t.expectWakeError(`deterministic failure for assistant`)

    await parent.send(
      `dispatch worker __fail__:worker Investigate the outage`,
      {
        from: `user`,
      }
    )
    await parent.waitFor((history) =>
      history.some(
        `state:children`,
        (event) => eventValueRecord(event)?.key === `dispatch-12-dispatch-1`
      )
    )
    await parent.waitForRun()

    await parent.send(`dispatch assistant __fail__:assistant Draft a summary`, {
      from: `user`,
    })
    const parentHistory = await parent.waitFor((history) => {
      return (
        history.some(
          `state:counters`,
          (event) =>
            eventValueRecord(event)?.key === `dispatchCount` &&
            eventValueRecord(event)?.value === 2
        ) &&
        history.some(
          `state:children`,
          (event) => eventValueRecord(event)?.key === `dispatch-12-dispatch-1`
        ) &&
        history.some(
          `state:children`,
          (event) => eventValueRecord(event)?.key === `dispatch-12-dispatch-2`
        ) &&
        history.count(
          `text_delta`,
          (event) => eventValueRecord(event)?.delta === `(no text output)`
        ) >= 2
      )
    })

    const workerChild = t.entity(
      `/${TYPES.f1WorkerChild}/dispatch-12-dispatch-1`
    )
    const assistantChild = t.entity(
      `/${TYPES.f1AssistantChild}/dispatch-12-dispatch-2`
    )
    const workerHistory = await workerChild.waitFor((history) =>
      history.some(
        `error`,
        (event) =>
          eventValueRecord(event)?.message ===
          `deterministic failure for worker`
      )
    )
    const assistantHistory = await assistantChild.waitFor((history) =>
      history.some(
        `error`,
        (event) =>
          eventValueRecord(event)?.message ===
          `deterministic failure for assistant`
      )
    )

    expect(
      parentHistory.find(
        `state:counters`,
        (event) =>
          eventValueRecord(event)?.key === `dispatchCount` &&
          eventValueRecord(event)?.value === 2
      )?.value
    ).toMatchObject({
      key: `dispatchCount`,
      value: 2,
    })
    expect(
      parentHistory.find(
        `state:children`,
        (event) => eventValueRecord(event)?.key === `dispatch-12-dispatch-1`
      )?.value
    ).toMatchObject({
      key: `dispatch-12-dispatch-1`,
      url: `/${TYPES.f1WorkerChild}/dispatch-12-dispatch-1`,
      kind: `worker`,
    })
    expect(
      parentHistory.find(
        `state:children`,
        (event) => eventValueRecord(event)?.key === `dispatch-12-dispatch-2`
      )?.value
    ).toMatchObject({
      key: `dispatch-12-dispatch-2`,
      url: `/${TYPES.f1AssistantChild}/dispatch-12-dispatch-2`,
      kind: `assistant`,
    })
    expect(
      workerHistory.find(
        `error`,
        (event) =>
          eventValueRecord(event)?.message ===
          `deterministic failure for worker`
      )?.value
    ).toMatchObject({
      message: `deterministic failure for worker`,
    })
    expect(
      assistantHistory.find(
        `error`,
        (event) =>
          eventValueRecord(event)?.message ===
          `deterministic failure for assistant`
      )?.value
    ).toMatchObject({
      message: `deterministic failure for assistant`,
    })
  }, 30_000)
})

describe(`G: map-reduce ordering`, () => {
  it(`G1: map-reduce returns results in chunk order even when completions differ`, async () => {
    const parent = await t.spawn(TYPES.g1MapReduce, `map-1`)
    await parent.send(`map_chunks summarize :: alpha@30|beta@0|gamma@10`, {
      from: `user`,
    })
    const parentHistory = await parent.waitForRun()

    const chunk1 = t.entity(`/${TYPES.fCoordWorker}/map-1-chunk-1`)
    const chunk2 = t.entity(`/${TYPES.fCoordWorker}/map-1-chunk-2`)
    const chunk3 = t.entity(`/${TYPES.fCoordWorker}/map-1-chunk-3`)
    await chunk1.waitForRun()
    await chunk2.waitForRun()
    await chunk3.waitForRun()

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `chunk-1:chunk-1::summarize:alpha | chunk-2:chunk-2::summarize:beta | chunk-3:chunk-3::summarize:gamma`
      )?.value
    ).toMatchObject({
      delta: `chunk-1:chunk-1::summarize:alpha | chunk-2:chunk-2::summarize:beta | chunk-3:chunk-3::summarize:gamma`,
    })
    expect(
      (await parent.history()).filteredSnapshot((entry) => {
        if (
          entry.type === `entity_created` ||
          entry.type === `message_received` ||
          entry.type === `manifest` ||
          entry.type === `tool_call` ||
          entry.type === `state:children`
        ) {
          return true
        }

        if (entry.type === `state:status`) {
          const value = eventValueRecord({ value: entry.value })
          return value?.value !== undefined
        }

        if (entry.type === `text_delta`) {
          return (
            entry.delta ===
            `winner:pro;pro:benefits outweigh risks :: Should we refactor now?;con:risks outweigh benefits :: Should we refactor now?`
          )
        }

        return false
      })
    ).toMatchSnapshot(`parent history`)
    expect(await chunk1.snapshot()).toMatchSnapshot(`chunk 1 history`)
    expect(await chunk2.snapshot()).toMatchSnapshot(`chunk 2 history`)
    expect(await chunk3.snapshot()).toMatchSnapshot(`chunk 3 history`)
  }, 30_000)

  it(`G2: map-reduce with one chunk still uses the orchestration path`, async () => {
    const parent = await t.spawn(TYPES.g1MapReduce, `map-2`)
    await parent.send(`map_chunks summarize :: only-one@0`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `chunk-1:chunk-1::summarize:only-one`
      )
    )

    const chunk = t.entity(`/${TYPES.fCoordWorker}/map-2-chunk-1`)
    const chunkHistory = await chunk.waitForRun()

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `chunk-1:chunk-1::summarize:only-one`
      )?.value
    ).toMatchObject({
      delta: `chunk-1:chunk-1::summarize:only-one`,
    })
    expect(
      parentHistory.count(
        `state:children`,
        (event) => eventValueRecord(event)?.key === `chunk-1`
      )
    ).toBe(1)
    expect(
      chunkHistory.find(
        `message_received`,
        (event) => eventValueRecord(event)?.payload === `summarize:only-one`
      )?.value
    ).toMatchObject({
      payload: `summarize:only-one`,
    })
  }, 30_000)

  it(`G3: map-reduce reuses chunk children across later wakes and returns only the latest chunk outputs`, async () => {
    const parent = await t.spawn(TYPES.g1MapReduce, `map-3`)

    await parent.send(`map_chunks summarize :: alpha@0|beta@0`, {
      from: `user`,
    })
    await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `chunk-1:chunk-1::summarize:alpha | chunk-2:chunk-2::summarize:beta`
      )
    )

    const chunk1 = t.entity(`/${TYPES.fCoordWorker}/map-3-chunk-1`)
    const chunk2 = t.entity(`/${TYPES.fCoordWorker}/map-3-chunk-2`)
    await chunk1.waitForRun()
    await chunk2.waitForRun()

    await parent.send(`map_chunks summarize :: newer-alpha@0|newer-beta@0`, {
      from: `user`,
    })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `chunk-1:chunk-1::summarize:newer-alpha | chunk-2:chunk-2::summarize:newer-beta`
      )
    )

    const textDeltas = parentHistory.events
      .filter((event) => event.type === `text_delta`)
      .map((event) => eventValueRecord(event)?.delta)
      .filter((value): value is string => typeof value === `string`)

    expect(textDeltas.at(-1)).toBe(
      `chunk-1:chunk-1::summarize:newer-alpha | chunk-2:chunk-2::summarize:newer-beta`
    )
    expect(textDeltas.at(-1)).not.toContain(`summarize:alpha\n\n`)
    expect(textDeltas.at(-1)).not.toContain(`summarize:beta\n\n`)
  }, 30_000)

  it(`G4: map-reduce uses a placeholder only for the failed chunk while keeping the others`, async () => {
    t.expectWakeError(`deterministic failure for chunk-2`)

    const parent = await t.spawn(TYPES.g1MapReduce, `map-4`)
    await parent.send(
      `map_chunks __fail__:chunk-2 summarize :: alpha@0|beta@0|gamma@0`,
      { from: `user` }
    )
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `chunk-1:chunk-1::summarize:alpha | chunk-2:(no text output) | chunk-3:chunk-3::summarize:gamma`
      )
    )

    const chunk1 = t.entity(`/${TYPES.fCoordWorker}/map-4-chunk-1`)
    const chunk2 = t.entity(`/${TYPES.fCoordWorker}/map-4-chunk-2`)
    const chunk3 = t.entity(`/${TYPES.fCoordWorker}/map-4-chunk-3`)
    await chunk1.waitForRun()
    await chunk3.waitForRun()
    const failedChunkHistory = await chunk2.history()

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `chunk-1:chunk-1::summarize:alpha | chunk-2:(no text output) | chunk-3:chunk-3::summarize:gamma`
      )?.value
    ).toMatchObject({
      delta:
        `chunk-1:chunk-1::summarize:alpha | ` +
        `chunk-2:(no text output) | ` +
        `chunk-3:chunk-3::summarize:gamma`,
    })
    expect(
      failedChunkHistory.events.some(
        (event) =>
          event.type === `error` &&
          eventValueRecord(event)?.message ===
            `deterministic failure for chunk-2`
      )
    ).toBe(true)
  }, 30_000)
})

describe(`H: pipeline sequencing`, () => {
  it(`H1: pipeline writes its state row during the first wake before stage execution`, async () => {
    const entity = await t.spawn(TYPES.h1Pipeline, `pipeline-1`)
    await entity.send(`run_pipeline seed :: stage-one`, { from: `user` })
    const history = await entity.waitForRun()

    expect(
      history.find(
        `state:pipeline`,
        (event) =>
          eventValueRecord(event)?.currentInput === `seed` &&
          eventValueRecord(event)?.currentStage === 0
      )?.value
    ).toMatchObject({
      currentInput: `seed`,
      currentStage: 0,
    })
    expect(history.indexOf(`state:pipeline`)).toBeLessThan(
      history.indexOf(`state:children`)
    )
    expect(await entity.snapshot()).toMatchSnapshot(`entity history`)
  }, 30_000)

  it(`H2: pipeline feeds each stage the previous stage output and persists final state`, async () => {
    const parent = await t.spawn(TYPES.h1Pipeline, `pipeline-2`)
    await parent.send(`run_pipeline seed :: stage-one|stage-two|stage-three`, {
      from: `user`,
    })
    const parentHistory = await parent.waitForRun()

    const stage1 = t.entity(`/${TYPES.fCoordWorker}/pipeline-2-stage-1`)
    const stage2 = t.entity(`/${TYPES.fCoordWorker}/pipeline-2-stage-2`)
    const stage3 = t.entity(`/${TYPES.fCoordWorker}/pipeline-2-stage-3`)
    await stage1.waitForRun()
    await stage2.waitForRun()
    await stage3.waitForRun()

    expect(
      parentHistory.find(`state:pipeline`, (event) => {
        const value = eventValueRecord(event)
        return (
          value?.currentStage === 3 &&
          value.currentInput === `stage-three::stage-two::stage-one::seed`
        )
      })?.value
    ).toMatchObject({
      currentStage: 3,
      currentInput: `stage-three::stage-two::stage-one::seed`,
    })
    expect(await parent.snapshot()).toMatchSnapshot(`parent history`)
    expect(await stage1.snapshot()).toMatchSnapshot(`stage 1 history`)
    expect(await stage2.snapshot()).toMatchSnapshot(`stage 2 history`)
    expect(await stage3.snapshot()).toMatchSnapshot(`stage 3 history`)
  }, 30_000)

  it(`H3: pipeline status caps at stage_5 while longer pipelines still complete`, async () => {
    const parent = await t.spawn(TYPES.h1Pipeline, `pipeline-3`)
    await parent.send(
      `run_pipeline seed :: one|two|three|four|five|six|seven`,
      {
        from: `user`,
      }
    )
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `state:pipeline`,
        (event) =>
          eventValueRecord(event)?.currentStage === 7 &&
          eventValueRecord(event)?.currentInput ===
            `seven::six::five::four::three::two::one::seed`
      )
    )

    const statuses = parentHistory.events
      .filter((event) => event.type === `state:status`)
      .map((event) => eventValueRecord(event)?.value)
      .filter((value): value is string => typeof value === `string`)

    expect(statuses).toContain(`stage_5`)
    expect(statuses).not.toContain(`stage_6`)
    expect(statuses).not.toContain(`stage_7`)
    expect(statuses.at(-1)).toBe(`done`)
    expect(
      parentHistory.find(
        `state:pipeline`,
        (event) =>
          eventValueRecord(event)?.currentStage === 7 &&
          eventValueRecord(event)?.currentInput ===
            `seven::six::five::four::three::two::one::seed`
      )?.value
    ).toMatchObject({
      currentStage: 7,
      currentInput: `seven::six::five::four::three::two::one::seed`,
    })
  }, 30_000)

  it(`H4: pipeline persists stage-by-stage currentInput updates through the run`, async () => {
    const parent = await t.spawn(TYPES.h1Pipeline, `pipeline-4`)
    await parent.send(`run_pipeline seed :: stage-one|stage-two|stage-three`, {
      from: `user`,
    })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `state:pipeline`,
        (event) =>
          eventValueRecord(event)?.currentStage === 3 &&
          eventValueRecord(event)?.currentInput ===
            `stage-three::stage-two::stage-one::seed`
      )
    )

    const pipelineStates = parentHistory.events
      .filter((event) => event.type === `state:pipeline`)
      .map((event) => eventValueRecord(event))
      .filter((value): value is Record<string, unknown> => !!value)

    expect(pipelineStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentStage: 0,
          currentInput: `seed`,
        }),
        expect.objectContaining({
          currentStage: 1,
          currentInput: `stage-one::seed`,
        }),
        expect.objectContaining({
          currentStage: 2,
          currentInput: `stage-two::stage-one::seed`,
        }),
        expect.objectContaining({
          currentStage: 3,
          currentInput: `stage-three::stage-two::stage-one::seed`,
        }),
      ])
    )
  }, 30_000)

  it(`H5: pipeline later runs reuse stage children but reset to the latest input chain`, async () => {
    const parent = await t.spawn(TYPES.h1Pipeline, `pipeline-5`)

    await parent.send(`run_pipeline seed :: stage-one|stage-two`, {
      from: `user`,
    })
    await parent.waitFor((history) =>
      history.some(
        `state:pipeline`,
        (event) =>
          eventValueRecord(event)?.currentStage === 2 &&
          eventValueRecord(event)?.currentInput === `stage-two::stage-one::seed`
      )
    )

    const stage1 = t.entity(`/${TYPES.fCoordWorker}/pipeline-5-stage-1`)
    const stage2 = t.entity(`/${TYPES.fCoordWorker}/pipeline-5-stage-2`)
    await stage1.waitForRun()
    await stage2.waitForRun()

    await parent.send(`run_pipeline fresh :: stage-one|stage-two`, {
      from: `user`,
    })
    const parentHistory = await parent.waitForRunCount(2)

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta === `stage-two::stage-one::fresh`
      )?.value
    ).toMatchObject({
      delta: `stage-two::stage-one::fresh`,
    })
    expect(
      parentHistory.find(
        `state:pipeline`,
        (event) =>
          eventValueRecord(event)?.currentStage === 2 &&
          eventValueRecord(event)?.currentInput ===
            `stage-two::stage-one::fresh`
      )?.value
    ).toMatchObject({
      currentStage: 2,
      currentInput: `stage-two::stage-one::fresh`,
    })
  }, 30_000)

  it(`H6: pipeline carries a failed stage forward as placeholder input for later stages`, async () => {
    const parent = await t.spawn(TYPES.h1Pipeline, `pipeline-6`)
    t.expectWakeError(`deterministic failure for explode`)

    await parent.send(`run_pipeline __fail__:explode seed :: explode|recover`, {
      from: `user`,
    })
    const parentHistory = await parent.waitForRun()

    const stage1 = t.entity(`/${TYPES.fCoordWorker}/pipeline-6-stage-1`)
    const stage2 = t.entity(`/${TYPES.fCoordWorker}/pipeline-6-stage-2`)
    const stage1History = await stage1.waitFor((history) =>
      history.some(
        `error`,
        (event) =>
          eventValueRecord(event)?.message ===
          `deterministic failure for explode`
      )
    )
    await stage2.waitForRun()

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `recover::(stage "explode" produced no text output)`
      )?.value
    ).toMatchObject({
      delta: `recover::(stage "explode" produced no text output)`,
    })
    expect(
      parentHistory.find(
        `state:pipeline`,
        (event) =>
          eventValueRecord(event)?.currentStage === 2 &&
          eventValueRecord(event)?.currentInput ===
            `recover::(stage "explode" produced no text output)`
      )?.value
    ).toMatchObject({
      currentStage: 2,
      currentInput: `recover::(stage "explode" produced no text output)`,
    })
    expect(
      stage1History.find(
        `error`,
        (event) =>
          eventValueRecord(event)?.message ===
          `deterministic failure for explode`
      )?.value
    ).toMatchObject({
      message: `deterministic failure for explode`,
    })
  }, 30_000)
})

describe(`M: deep researcher coordination`, () => {
  it(`M1: researcher workers start from spawn initialMessage without an extra send`, async () => {
    const parent = await t.spawn(TYPES.m1Researcher, `research-1`)

    await parent.send(
      `spawn_researchers Durable Streams :: History|Applications`,
      {
        from: `user`,
      }
    )
    await parent.waitForRun()

    const historyWorker = t.entity(
      `/${TYPES.m1ResearchWorker}/research-1-history`
    )
    const applicationsWorker = t.entity(
      `/${TYPES.m1ResearchWorker}/research-1-applications`
    )
    const historyHistory = await historyWorker.waitForRun()
    const applicationsHistory = await applicationsWorker.waitForRun()

    expect(historyHistory.count(`message_received`)).toBe(1)
    expect(applicationsHistory.count(`message_received`)).toBe(1)
    expect(historyHistory.find(`message_received`)?.value).toMatchObject({
      payload: `Durable Streams`,
    })
    expect(applicationsHistory.find(`message_received`)?.value).toMatchObject({
      payload: `Durable Streams`,
    })
  }, 30_000)

  it(`M2: wait_for_results before spawning researchers returns the empty-state error path`, async () => {
    const parent = await t.spawn(TYPES.m1Researcher, `research-2`)

    await parent.send(`wait_for_results`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `No researcher agents have been spawned yet.`
      )
    )

    expect(
      parentHistory.find(
        `tool_call`,
        (event) =>
          eventValueRecord(event)?.tool_name === `wait_for_results` &&
          eventValueRecord(event)?.status === `failed`
      )?.value
    ).toMatchObject({
      tool_name: `wait_for_results`,
      status: `failed`,
    })
  }, 30_000)

  it(`M3: separate researcher entities keep child results isolated across later wakes`, async () => {
    const alpha = await t.spawn(TYPES.m1Researcher, `research-3a`)
    const beta = await t.spawn(TYPES.m1Researcher, `research-3b`)

    await alpha.send(`spawn_researchers Alpha Topic :: History|Applications`, {
      from: `user`,
    })
    await beta.send(`spawn_researchers Beta Topic :: History|Applications`, {
      from: `user`,
    })
    await alpha.waitForRun()
    await beta.waitForRun()

    await alpha.send(`wait_for_results`, { from: `user` })
    await beta.send(`wait_for_results`, { from: `user` })

    const alphaHistory = await alpha.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `results:Applications=research:Applications:Alpha Topic;History=research:History:Alpha Topic`
      )
    )
    const betaHistory = await beta.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `results:Applications=research:Applications:Beta Topic;History=research:History:Beta Topic`
      )
    )

    expect(
      alphaHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `results:Applications=research:Applications:Alpha Topic;History=research:History:Alpha Topic`
      )?.value
    ).toMatchObject({
      delta:
        `results:Applications=research:Applications:Alpha Topic;` +
        `History=research:History:Alpha Topic`,
    })
    expect(
      betaHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `results:Applications=research:Applications:Beta Topic;History=research:History:Beta Topic`
      )?.value
    ).toMatchObject({
      delta:
        `results:Applications=research:Applications:Beta Topic;` +
        `History=research:History:Beta Topic`,
    })
    expect(
      new Set(
        alphaHistory.events
          .filter((event) => event.type === `state:children`)
          .map((event) => String(eventValueRecord(event)?.url ?? ``))
      )
    ).toEqual(
      new Set([
        `/${TYPES.m1ResearchWorker}/research-3a-history`,
        `/${TYPES.m1ResearchWorker}/research-3a-applications`,
      ])
    )
    expect(
      new Set(
        betaHistory.events
          .filter((event) => event.type === `state:children`)
          .map((event) => String(eventValueRecord(event)?.url ?? ``))
      )
    ).toEqual(
      new Set([
        `/${TYPES.m1ResearchWorker}/research-3b-history`,
        `/${TYPES.m1ResearchWorker}/research-3b-applications`,
      ])
    )
  }, 30_000)
})

describe(`I: peer review coordination`, () => {
  it(`I1: peer review aggregates three reviewer writes through shared state`, async () => {
    const parent = await t.spawn(TYPES.i1PeerReview, `review-1`)
    const sharedState = t.sharedState(`review-review-1`)

    await parent.send(`start_review launch checklist`, { from: `user` })
    await parent.waitForRun()
    await sharedState.waitForTypeCount(`shared:review`, 3)
    await parent.waitFor(
      (history) =>
        history.count(`manifest`, (event) => {
          const value = eventValueRecord(event)
          const key = String(value?.key ?? ``)
          return (
            key === `shared-state:review-review-1` ||
            key === `child:review-worker-i1:review-1-clarity` ||
            key === `child:review-worker-i1:review-1-correctness` ||
            key === `child:review-worker-i1:review-1-completeness`
          )
        }) === 4
    )

    await parent.send(`summarize_reviews`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `average:8.0;count:3;clarity-reviewer:8;correctness-reviewer:9;completeness-reviewer:7`
      )
    )

    const clarity = t.entity(`/${TYPES.i1ReviewWorker}/review-1-clarity`)
    const correctness = t.entity(
      `/${TYPES.i1ReviewWorker}/review-1-correctness`
    )
    const completeness = t.entity(
      `/${TYPES.i1ReviewWorker}/review-1-completeness`
    )
    await clarity.waitForRun()
    await correctness.waitForRun()
    await completeness.waitForRun()

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `average:8.0;count:3;clarity-reviewer:8;correctness-reviewer:9;completeness-reviewer:7`
      )?.value
    ).toMatchObject({
      delta: `average:8.0;count:3;clarity-reviewer:8;correctness-reviewer:9;completeness-reviewer:7`,
    })
    expect(await parent.snapshot()).toMatchSnapshot(`parent history`)
    expect(await clarity.snapshot()).toMatchSnapshot(`clarity history`)
    expect(await correctness.snapshot()).toMatchSnapshot(`correctness history`)
    expect(await completeness.snapshot()).toMatchSnapshot(
      `completeness history`
    )
    expect(await sharedState.snapshot()).toMatchSnapshot(`shared state history`)
  }, 30_000)

  it(`I2: summarize_reviews before any reviews exist returns the empty-state error path`, async () => {
    const parent = await t.spawn(TYPES.i1PeerReview, `review-2`)
    await parent.send(`summarize_reviews`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta === `No reviews have been written yet.`
      )
    )

    expect(
      parentHistory.find(
        `tool_call`,
        (event) =>
          eventValueRecord(event)?.tool_name === `summarize_reviews` &&
          eventValueRecord(event)?.status === `failed`
      )?.value
    ).toMatchObject({
      tool_name: `summarize_reviews`,
      status: `failed`,
    })
    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta === `No reviews have been written yet.`
      )?.value
    ).toMatchObject({
      delta: `No reviews have been written yet.`,
    })
  }, 30_000)

  it(`I3: peer review with one configured reviewer summarizes only that durable row`, async () => {
    const parent = await t.spawn(TYPES.i1PeerReview, `review-3`, {
      reviewerCount: 1,
    })
    const sharedState = t.sharedState(`review-review-3`)

    await parent.send(`start_review launch checklist`, { from: `user` })
    await parent.waitForRun()
    await sharedState.waitForTypeCount(`shared:review`, 1)

    await parent.send(`summarize_reviews`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `average:8.0;count:1;clarity-reviewer:8`
      )
    )

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `average:8.0;count:1;clarity-reviewer:8`
      )?.value
    ).toMatchObject({
      delta: `average:8.0;count:1;clarity-reviewer:8`,
    })
    expect(
      parentHistory.count(`state:children`, (event) => {
        const value = eventValueRecord(event)
        return value?.key === `clarity`
      })
    ).toBe(1)
  }, 30_000)

  it(`I4: peer review with two configured reviewers summarizes only those durable rows`, async () => {
    const parent = await t.spawn(TYPES.i1PeerReview, `review-4`, {
      reviewerCount: 2,
    })
    const sharedState = t.sharedState(`review-review-4`)

    await parent.send(`start_review launch checklist`, { from: `user` })
    await parent.waitForRun()
    await sharedState.waitForTypeCount(`shared:review`, 2)

    await parent.send(`summarize_reviews`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `average:8.5;count:2;clarity-reviewer:8;correctness-reviewer:9`
      )
    )

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `average:8.5;count:2;clarity-reviewer:8;correctness-reviewer:9`
      )?.value
    ).toMatchObject({
      delta: `average:8.5;count:2;clarity-reviewer:8;correctness-reviewer:9`,
    })
    expect(
      parentHistory.count(`state:children`, (event) => {
        const value = eventValueRecord(event)
        return value?.key === `clarity` || value?.key === `correctness`
      })
    ).toBe(2)
  }, 30_000)
})

describe(`J: debate coordination`, () => {
  it(`J1: debate parent reads both sides from shared state before issuing a ruling`, async () => {
    const parent = await t.spawn(TYPES.j1Debate, `debate-1`)
    const sharedState = t.sharedState(`debate-debate-1`)

    await parent.send(`start_debate Should we refactor now?`, { from: `user` })
    await parent.waitForRun()
    await sharedState.waitForTypeCount(`shared:argument`, 2)

    await parent.send(`end_debate`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `winner:pro;pro:benefits outweigh risks :: Should we refactor now?;con:risks outweigh benefits :: Should we refactor now?`
      )
    )

    const pro = t.entity(`/${TYPES.j1DebateWorker}/debate-1-pro`)
    const con = t.entity(`/${TYPES.j1DebateWorker}/debate-1-con`)
    await pro.waitForRun()
    await con.waitForRun()

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `winner:pro;pro:benefits outweigh risks :: Should we refactor now?;con:risks outweigh benefits :: Should we refactor now?`
      )?.value
    ).toMatchObject({
      delta: `winner:pro;pro:benefits outweigh risks :: Should we refactor now?;con:risks outweigh benefits :: Should we refactor now?`,
    })
    const parentManifests = parentHistory
      .filteredSnapshot((entry) => entry.type === `manifest`)
      .map((entry) => eventValueRecord({ value: entry.manifest }))
    const parentManifestKeys = parentManifests.map((manifest) =>
      String(manifest?.key ?? ``)
    )
    expect(parentManifestKeys).toEqual(
      expect.arrayContaining([
        `shared-state:debate-debate-1`,
        `source:db:debate-debate-1`,
        `child:${TYPES.j1DebateWorker}:debate-1-pro`,
        `child:${TYPES.j1DebateWorker}:debate-1-con`,
      ])
    )
    expect(
      parentHistory.find(
        `tool_call`,
        (event) =>
          eventValueRecord(event)?.tool_name === `end_debate` &&
          eventValueRecord(event)?.status === `completed`
      )?.value
    ).toMatchObject({
      tool_name: `end_debate`,
      status: `completed`,
      result: `{"count":2}`,
    })
    expect(
      parentHistory.count(
        `message_received`,
        (event) => eventValueRecord(event)?.payload === `end_debate`
      )
    ).toBe(1)
    expect(await pro.snapshot()).toMatchSnapshot(`pro history`)
    expect(await con.snapshot()).toMatchSnapshot(`con history`)
    expect(
      sortSnapshotEntriesByDebateSide(await sharedState.snapshot())
    ).toMatchSnapshot(`shared state history`)
  }, 30_000)

  it(`J2: end_debate before any arguments exist returns the empty-state error path`, async () => {
    const parent = await t.spawn(TYPES.j1Debate, `debate-2`)
    await parent.send(`end_debate`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `No debate arguments have been recorded yet.`
      )
    )

    expect(
      parentHistory.find(
        `tool_call`,
        (event) =>
          eventValueRecord(event)?.tool_name === `end_debate` &&
          eventValueRecord(event)?.status === `failed`
      )?.value
    ).toMatchObject({
      tool_name: `end_debate`,
      status: `failed`,
    })
    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `No debate arguments have been recorded yet.`
      )?.value
    ).toMatchObject({
      delta: `No debate arguments have been recorded yet.`,
    })
  }, 30_000)

  it(`J3: debate with only one durable side stays partial until the missing side arrives`, async () => {
    const parent = await t.spawn(TYPES.j1Debate, `debate-3`)
    const sharedState = t.sharedState(`debate-debate-3`)

    await parent.send(`start_side pro Should we refactor now?`, {
      from: `user`,
    })
    await parent.waitForRun()
    await sharedState.waitForTypeCount(`shared:argument`, 1)

    await parent.send(`end_debate`, { from: `user` })
    const partialHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `No debate arguments have been recorded yet.`
      )
    )

    expect(
      partialHistory.find(
        `tool_call`,
        (event) =>
          eventValueRecord(event)?.tool_name === `end_debate` &&
          eventValueRecord(event)?.status === `failed`
      )?.value
    ).toMatchObject({
      tool_name: `end_debate`,
      status: `failed`,
    })

    await parent.send(`start_side con Should we refactor now?`, {
      from: `user`,
    })
    await sharedState.waitForTypeCount(`shared:argument`, 2)

    await parent.send(`end_debate`, { from: `user` })
    const finalHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `winner:pro;pro:benefits outweigh risks :: Should we refactor now?;con:risks outweigh benefits :: Should we refactor now?`
      )
    )

    expect(
      finalHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `winner:pro;pro:benefits outweigh risks :: Should we refactor now?;con:risks outweigh benefits :: Should we refactor now?`
      )?.value
    ).toMatchObject({
      delta: `winner:pro;pro:benefits outweigh risks :: Should we refactor now?;con:risks outweigh benefits :: Should we refactor now?`,
    })
  }, 30_000)
})

describe(`K: wiki coordination`, () => {
  it(`K1: wiki specialists accumulate shared articles that a later query can read`, async () => {
    const parent = await t.spawn(TYPES.k1Wiki, `wiki-1`)
    const sharedState = t.sharedState(`wiki-wiki-1`)

    await parent.send(`create_wiki Durable Streams :: History|Applications`, {
      from: `user`,
    })
    await parent.waitForTypeCount(`state:children`, 2)
    await sharedState.waitForTypeCount(`shared:wiki_article`, 2)
    await t.waitForSettled(60_000)

    await parent.send(`query_wiki Durable Streams`, { from: `user` })
    const parentHistory = await parent.waitFor(
      (history) =>
        history.some(
          `text_delta`,
          (event) =>
            eventValueRecord(event)?.delta ===
            `articles:2;applications-1:Applications Basics;history-1:History Basics`
        ),
      60_000
    )

    const historyWorker = t.entity(`/${TYPES.k1WikiWorker}/wiki-1-history`)
    const applicationsWorker = t.entity(
      `/${TYPES.k1WikiWorker}/wiki-1-applications`
    )
    await historyWorker.waitForRun()
    await applicationsWorker.waitForRun()
    await t.waitForSettled(60_000)

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `articles:2;applications-1:Applications Basics;history-1:History Basics`
      )?.value
    ).toMatchObject({
      delta: `articles:2;applications-1:Applications Basics;history-1:History Basics`,
    })
    expect(await parent.snapshot()).toMatchSnapshot(`parent history`)
    expect(await historyWorker.snapshot()).toMatchSnapshot(
      `history worker history`
    )
    expect(await applicationsWorker.snapshot()).toMatchSnapshot(
      `applications worker history`
    )
    expect(await sharedState.snapshot()).toMatchSnapshot(`shared state history`)
  }, 60_000)

  it(`K2: repeating create_wiki reuses existing specialists and only spawns missing subtopics`, async () => {
    const parent = await t.spawn(TYPES.k1Wiki, `wiki-2`)
    const sharedState = t.sharedState(`wiki-wiki-2`)

    await parent.send(`create_wiki Durable Streams :: History|Applications`, {
      from: `user`,
    })
    await parent.waitForRun()
    await parent.waitForTypeCount(`state:children`, 2)
    await sharedState.waitForTypeCount(`shared:wiki_article`, 2)

    await parent.send(
      `create_wiki Durable Streams :: History|Applications|Internals`,
      {
        from: `user`,
      }
    )
    const parentHistory = await parent.waitFor((history) => {
      const childKeys = new Set(
        history.events
          .filter((event) => event.type === `state:children`)
          .map((event) => String(eventValueRecord(event)?.key ?? ``))
          .filter(Boolean)
      )
      return (
        history.some(
          `text_delta`,
          (event) =>
            eventValueRecord(event)?.delta ===
            `wiki_started:1:2:History,Applications,Internals`
        ) && childKeys.size === 3
      )
    })
    await sharedState.waitForTypeCount(`shared:wiki_article`, 3)

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `wiki_started:1:2:History,Applications,Internals`
      )?.value
    ).toMatchObject({
      delta: `wiki_started:1:2:History,Applications,Internals`,
    })
    expect(
      new Set(
        parentHistory.events
          .filter((event) => event.type === `state:children`)
          .map((event) => String(eventValueRecord(event)?.key ?? ``))
          .filter(Boolean)
      )
    ).toEqual(new Set([`history`, `applications`, `internals`]))
    expect(
      new Map(
        parentHistory.events
          .filter((event) => event.type === `state:children`)
          .map((event) => {
            const value = eventValueRecord(event)
            return [
              String(value?.key ?? ``),
              String(value?.kind ?? ``),
            ] as const
          })
          .filter(([key, kind]) => !!key && !!kind)
      )
    ).toEqual(
      new Map([
        [`history`, `History`],
        [`applications`, `Applications`],
        [`internals`, `Internals`],
      ])
    )
    expect(
      parentHistory.find(
        `state:meta`,
        (event) =>
          eventValueRecord(event)?.topic === `Durable Streams` &&
          eventValueRecord(event)?.specialistCount === 3
      )?.value
    ).toMatchObject({
      topic: `Durable Streams`,
      specialistCount: 3,
    })
    expect(
      parentHistory.count(`text_delta`, (event) =>
        String(eventValueRecord(event)?.delta ?? ``).startsWith(`unknown:{`)
      )
    ).toBe(0)
    expect(parentHistory.completedRunCount()).toBe(2)
  }, 30_000)

  it(`K3: get_wiki_status reports complete coverage after specialist articles land`, async () => {
    const parent = await t.spawn(TYPES.k1Wiki, `wiki-3`)
    const sharedState = t.sharedState(`wiki-wiki-3`)
    await parent.send(`create_wiki Durable Streams :: History|Applications`, {
      from: `user`,
    })
    await parent.waitForTypeCount(`state:children`, 2)
    await sharedState.waitForTypeCount(`shared:wiki_article`, 2)

    await parent.send(`get_wiki_status`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `status:2/2;pending:none`
      )
    )

    expect(
      parentHistory.find(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `status:2/2;pending:none`
      )?.value
    ).toMatchObject({
      delta: `status:2/2;pending:none`,
    })
  }, 30_000)

  it(`K4: create_wiki rejects switching the topic on an existing wiki`, async () => {
    const parent = await t.spawn(TYPES.k1Wiki, `wiki-4`)
    const sharedState = t.sharedState(`wiki-wiki-4`)

    await parent.send(`create_wiki Durable Streams :: History|Applications`, {
      from: `user`,
    })
    await parent.waitForTypeCount(`state:children`, 2)
    await sharedState.waitForTypeCount(`shared:wiki_article`, 2)

    await parent.send(`create_wiki Ancient Rome :: Agriculture|Politics`, {
      from: `user`,
    })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `Wiki topic is already "Durable Streams" and cannot be changed to "Ancient Rome".`
      )
    )

    expect(
      parentHistory.find(
        `tool_call`,
        (event) =>
          eventValueRecord(event)?.tool_name === `create_wiki` &&
          eventValueRecord(event)?.status === `failed`
      )?.value
    ).toMatchObject({
      tool_name: `create_wiki`,
      status: `failed`,
    })
    expect(
      parentHistory.find(
        `state:meta`,
        (event) => eventValueRecord(event)?.key === `wiki`
      )?.value
    ).toMatchObject({
      key: `wiki`,
      topic: `Durable Streams`,
      specialistCount: 2,
    })
    expect(
      new Set(
        parentHistory.events
          .filter((event) => event.type === `state:children`)
          .map((event) => String(eventValueRecord(event)?.key ?? ``))
          .filter(Boolean)
      )
    ).toEqual(new Set([`history`, `applications`]))
  }, 30_000)

  it(`K5: query_wiki before any specialist articles exist returns the empty-state message`, async () => {
    const parent = await t.spawn(TYPES.k1Wiki, `wiki-5`)
    await parent.send(`query_wiki Durable Streams`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `No wiki articles have been written yet.`
      )
    )

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `No wiki articles have been written yet.`
      )?.value
    ).toMatchObject({
      delta: `No wiki articles have been written yet.`,
    })
    expect(
      parentHistory.find(
        `tool_call`,
        (event) =>
          eventValueRecord(event)?.tool_name === `query_wiki` &&
          eventValueRecord(event)?.status === `completed`
      )?.value
    ).toMatchObject({
      tool_name: `query_wiki`,
      status: `completed`,
    })
  }, 30_000)

  it(`K6: repeating create_wiki with the same topic and subtopics is idempotent`, async () => {
    const parent = await t.spawn(TYPES.k1Wiki, `wiki-6`)
    const sharedState = t.sharedState(`wiki-wiki-6`)

    await parent.send(`create_wiki Durable Streams :: History|Applications`, {
      from: `user`,
    })
    await parent.waitForTypeCount(`state:children`, 2)
    await sharedState.waitForTypeCount(`shared:wiki_article`, 2)

    await parent.send(`create_wiki Durable Streams :: History|Applications`, {
      from: `user`,
    })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `wiki_started:0:2:History,Applications`
      )
    )

    expect(
      parentHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `wiki_started:0:2:History,Applications`
      )?.value
    ).toMatchObject({
      delta: `wiki_started:0:2:History,Applications`,
    })
    expect(
      new Set(
        parentHistory.events
          .filter((event) => event.type === `state:children`)
          .map((event) => String(eventValueRecord(event)?.key ?? ``))
          .filter(Boolean)
      )
    ).toEqual(new Set([`history`, `applications`]))
  }, 30_000)

  it(`K7: get_wiki_status before creating a wiki reports the empty state`, async () => {
    const parent = await t.spawn(TYPES.k1Wiki, `wiki-7`)
    await parent.send(`get_wiki_status`, { from: `user` })
    const parentHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `status:0/0;pending:none`
      )
    )

    expect(
      parentHistory.find(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `status:0/0;pending:none`
      )?.value
    ).toMatchObject({
      delta: `status:0/0;pending:none`,
    })
  }, 30_000)

  it(`K8: wiki keeps durable child metadata and shared articles carry topic and author details`, async () => {
    const parent = await t.spawn(TYPES.k1Wiki, `wiki-8`)
    const sharedState = t.sharedState(`wiki-wiki-8`)

    await parent.send(`create_wiki Durable Streams :: History|Applications`, {
      from: `user`,
    })
    const parentHistory = await parent.waitFor((history) => {
      const childKeys = new Set(
        history.events
          .filter((event) => event.type === `state:children`)
          .map((event) => String(eventValueRecord(event)?.key ?? ``))
          .filter(Boolean)
      )
      return childKeys.size === 2
    })
    const sharedHistory = await sharedState.waitForTypeCount(
      `shared:wiki_article`,
      2
    )

    expect(
      parentHistory.find(
        `state:children`,
        (event) => eventValueRecord(event)?.key === `history`
      )?.value
    ).toMatchObject({
      key: `history`,
      kind: `History`,
    })
    expect(
      parentHistory.find(
        `state:children`,
        (event) => eventValueRecord(event)?.key === `applications`
      )?.value
    ).toMatchObject({
      key: `applications`,
      kind: `Applications`,
    })
    expect(
      new Map(
        sharedHistory.events
          .filter((event) => event.type === `shared:wiki_article`)
          .map((event) => {
            const value = eventValueRecord(event)
            return [
              String(value?.key ?? ``),
              {
                topic: String(value?.topic ?? ``),
                author: String(value?.author ?? ``),
              },
            ] as const
          })
      )
    ).toEqual(
      new Map([
        [
          `applications-1`,
          {
            topic: `Applications Basics`,
            author: `Applications Specialist`,
          },
        ],
        [
          `history-1`,
          {
            topic: `History Basics`,
            author: `History Specialist`,
          },
        ],
      ])
    )
  }, 30_000)

  it(`K9: idempotent wiki recreation does not duplicate shared article rows`, async () => {
    const parent = await t.spawn(TYPES.k1Wiki, `wiki-9`)
    const sharedState = t.sharedState(`wiki-wiki-9`)

    await parent.send(`create_wiki Durable Streams :: History|Applications`, {
      from: `user`,
    })
    await parent.waitForTypeCount(`state:children`, 2)
    await sharedState.waitForTypeCount(`shared:wiki_article`, 2)

    await parent.send(`create_wiki Durable Streams :: History|Applications`, {
      from: `user`,
    })
    await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `wiki_started:0:2:History,Applications`
      )
    )

    const sharedHistory = await sharedState.history()

    expect(sharedHistory.count(`shared:wiki_article`)).toBe(2)
    expect(
      new Set(
        sharedHistory.events
          .filter((event) => event.type === `shared:wiki_article`)
          .map((event) => String(eventValueRecord(event)?.key ?? ``))
          .filter(Boolean)
      )
    ).toEqual(new Set([`history-1`, `applications-1`]))
  }, 30_000)

  it(`K10: same-topic wiki expansion adds only the missing article and updates later query coverage`, async () => {
    const parent = await t.spawn(TYPES.k1Wiki, `wiki-10`)
    const sharedState = t.sharedState(`wiki-wiki-10`)

    await parent.send(`create_wiki Durable Streams :: History|Applications`, {
      from: `user`,
    })
    await parent.waitForTypeCount(`state:children`, 2)
    await sharedState.waitForTypeCount(`shared:wiki_article`, 2)

    await parent.send(
      `create_wiki Durable Streams :: History|Applications|Internals`,
      {
        from: `user`,
      }
    )
    await sharedState.waitForTypeCount(`shared:wiki_article`, 3)

    await parent.send(`query_wiki Durable Streams`, { from: `user` })
    const queryHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `articles:3;applications-1:Applications Basics;history-1:History Basics;internals-1:Internals Basics`
      )
    )

    expect(
      queryHistory.find(
        `state:meta`,
        (event) =>
          eventValueRecord(event)?.topic === `Durable Streams` &&
          eventValueRecord(event)?.specialistCount === 3
      )?.value
    ).toMatchObject({
      topic: `Durable Streams`,
      specialistCount: 3,
    })
    expect(
      queryHistory.find(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `articles:3;applications-1:Applications Basics;history-1:History Basics;internals-1:Internals Basics`
      )?.value
    ).toMatchObject({
      delta:
        `articles:3;applications-1:Applications Basics;` +
        `history-1:History Basics;internals-1:Internals Basics`,
    })

    await parent.send(`get_wiki_status`, { from: `user` })
    const statusHistory = await parent.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `status:3/3;pending:none`
      )
    )

    expect(
      statusHistory.find(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === `status:3/3;pending:none`
      )?.value
    ).toMatchObject({
      delta: `status:3/3;pending:none`,
    })
  }, 30_000)
})

describe(`L: reactive observation flows`, () => {
  it(`L1: explicit observe plus createEffect forwards insert, update, and delete notices`, async () => {
    const child = await t.spawn(TYPES.e1Child, `child-l1`)
    const watcher = await t.spawn(TYPES.l1Watcher, `watcher-l1`)

    await watcher.send(`watch ${child.entityUrl}`, { from: `user` })
    await watcher.waitForRun()

    await child.send(`insert item-1 alpha`, { from: `user` })
    await child.waitForOperation(`observed_item`, `insert`)
    await watcher.waitForTypeCount(`state:notice`, 1)

    await child.send(`update item-1 beta`, { from: `user` })
    await child.waitForOperation(`observed_item`, `update`)
    await watcher.waitForTypeCount(`state:notice`, 2)

    await child.send(`delete item-1`, { from: `user` })
    await child.waitForOperation(`observed_item`, `delete`)
    await watcher.waitForTypeCount(`state:notice`, 3)

    const watcherHistory = await watcher.history()

    await watcher.send(`report`, { from: `user` })
    const expectedReport =
      `insert:items:item-1:alpha|` +
      `update:items:item-1:alpha->beta|` +
      `delete:items:item-1:beta`
    const reportHistory = await watcher.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === expectedReport
      )
    )

    expect(
      watcherHistory.events
        .filter((event) => event.type === `state:notice`)
        .map((event) => eventValueRecord(event)?.text)
    ).toEqual([
      `insert:items:item-1:alpha`,
      `update:items:item-1:alpha->beta`,
      `delete:items:item-1:beta`,
    ])
    expect(
      reportHistory.find(
        `text_delta`,
        (event) => eventValueRecord(event)?.delta === expectedReport
      )?.value
    ).toMatchObject({
      delta: expectedReport,
    })
    expect(await child.snapshot()).toMatchSnapshot(`child history`)
    expect(
      reportHistory.filteredSnapshot(
        (entry) =>
          entry.type !== `manifest` &&
          entry.type !== `replay_watermark` &&
          entry.type !== `wake`
      )
    ).toMatchSnapshot(`watcher history`)
  }, 30_000)

  it(`L2: re-waking the watcher without new child changes does not duplicate prior observation notices`, async () => {
    const child = await t.spawn(TYPES.e1Child, `child-l2`)
    const watcher = await t.spawn(TYPES.l1Watcher, `watcher-l2`)

    await watcher.send(`watch ${child.entityUrl}`, { from: `user` })
    await watcher.waitForRun()

    await child.send(`insert item-1 alpha`, { from: `user` })
    await child.waitForRun()
    await watcher.waitForTypeCount(`state:notice`, 1)

    const reportDelta = `insert:items:item-1:alpha`
    await watcher.send(`report`, { from: `user` })
    await watcher.waitFor(
      (history) =>
        history.count(
          `text_delta`,
          (event) => eventValueRecord(event)?.delta === reportDelta
        ) >= 1
    )
    await t.waitForSettled(60_000)

    await watcher.send(`report`, { from: `user` })
    const watcherHistory = await watcher.waitFor(
      (history) =>
        history.count(
          `text_delta`,
          (event) => eventValueRecord(event)?.delta === reportDelta
        ) >= 2
    )

    expect(watcherHistory.count(`state:notice`)).toBe(1)
    expect(
      watcherHistory.find(
        `state:notice`,
        (event) => eventValueRecord(event)?.text === `insert:items:item-1:alpha`
      )?.value
    ).toMatchObject({
      key: `notice-0001`,
      text: `insert:items:item-1:alpha`,
    })
    expect(
      watcherHistory.events
        .filter((event) => event.type === `text_delta`)
        .at(-1)?.value
    ).toMatchObject({
      delta: `insert:items:item-1:alpha`,
    })
    expect(await child.snapshot()).toMatchSnapshot(`child history`)
    expect(
      watcherHistory.filteredSnapshot(
        (entry) =>
          entry.type !== `manifest` &&
          entry.type !== `replay_watermark` &&
          entry.type !== `wake`
      )
    ).toMatchSnapshot(`watcher history`)
  }, 60_000)

  it(`L3: a child delete while the watcher is asleep replays as one delete notice`, async () => {
    const child = await t.spawn(TYPES.e1Child, `child-l3`)
    const watcher = await t.spawn(TYPES.l1Watcher, `watcher-l3`)

    await watcher.send(`watch ${child.entityUrl}`, { from: `user` })
    await watcher.waitForRun()

    await child.send(`insert item-1 alpha`, { from: `user` })
    await child.waitForRun()
    await watcher.waitForTypeCount(`state:notice`, 1)
    await t.waitForSettled(60_000)

    const initialReportDelta = `insert:items:item-1:alpha`
    await watcher.send(`report`, { from: `user` })
    await watcher.waitFor(
      (history) =>
        history.count(
          `text_delta`,
          (event) => eventValueRecord(event)?.delta === initialReportDelta
        ) >= 1,
      60_000
    )
    await watcher.waitForSettled(60_000)

    await child.send(`delete item-1`, { from: `user` })
    await child.waitForOperation(`observed_item`, `delete`)
    await watcher.waitForTypeCount(`state:notice`, 2, { timeoutMs: 30_000 })
    await t.waitForSettled(60_000)

    const finalReportDelta = `insert:items:item-1:alpha|delete:items:item-1:alpha`
    await watcher.send(`report`, { from: `user` })
    await watcher.waitFor(
      (history) =>
        history.count(
          `text_delta`,
          (event) => eventValueRecord(event)?.delta === finalReportDelta
        ) >= 1
    )

    await watcher.send(`report`, { from: `user` })
    const watcherHistory = await watcher.waitFor(
      (history) =>
        history.count(
          `text_delta`,
          (event) => eventValueRecord(event)?.delta === finalReportDelta
        ) >= 2
    )

    expect(
      watcherHistory.events
        .filter((event) => event.type === `state:notice`)
        .map((event) => eventValueRecord(event)?.text)
    ).toEqual([`insert:items:item-1:alpha`, `delete:items:item-1:alpha`])
    expect(watcherHistory.count(`state:notice`)).toBe(2)
    expect(
      watcherHistory.events
        .filter((event) => event.type === `text_delta`)
        .at(-1)?.value
    ).toMatchObject({
      delta: `insert:items:item-1:alpha|delete:items:item-1:alpha`,
    })
  }, 60_000)

  it(`L4: watching the same child twice stays deduped`, async () => {
    const child = await t.spawn(TYPES.e1Child, `child-l4`)
    const watcher = await t.spawn(TYPES.l1Watcher, `watcher-l4`)

    await watcher.send(`watch ${child.entityUrl}`, { from: `user` })
    await watcher.waitForRun()

    await watcher.send(`watch ${child.entityUrl}`, { from: `user` })
    const postSecondWatch = await watcher.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `already-watching:${child.entityUrl}:items`
      )
    )

    expect(
      postSecondWatch.events
        .filter((event) => event.type === `text_delta`)
        .at(-1)?.value
    ).toMatchObject({
      delta: `already-watching:${child.entityUrl}:items`,
    })

    expect(
      postSecondWatch.events.filter(
        (entry) =>
          entry.type === `manifest` &&
          entry.key === manifestSourceKey(`entity`, child.entityUrl) &&
          entry.headers?.operation === `insert`
      )
    ).toHaveLength(1)

    await child.send(`insert item-1 alpha`, { from: `user` })
    await child.waitForRun()
    const watcherHistory = await watcher.waitForTypeCount(`state:notice`, 1)

    expect(watcherHistory.count(`state:notice`)).toBe(1)
    expect(
      watcherHistory.find(
        `state:notice`,
        (event) => eventValueRecord(event)?.text === `insert:items:item-1:alpha`
      )?.value
    ).toMatchObject({
      key: `notice-0001`,
      text: `insert:items:item-1:alpha`,
    })
  }, 30_000)

  it(`L5: one watcher can observe multiple children and preserve source attribution`, async () => {
    const childA = await t.spawn(TYPES.e1Child, `child-l5-a`)
    const childB = await t.spawn(TYPES.e1Child, `child-l5-b`)
    const watcher = await t.spawn(TYPES.l1Watcher, `watcher-l5`)

    await watcher.send(`watch ${childA.entityUrl}`, { from: `user` })
    await watcher.waitForRun()
    await watcher.send(`watch ${childB.entityUrl}`, { from: `user` })
    await watcher.waitFor((history) =>
      history.some(
        `text_delta`,
        (event) =>
          eventValueRecord(event)?.delta ===
          `watching:${childB.entityUrl}:items`
      )
    )

    await childA.send(`insert item-a alpha`, { from: `user` })
    await childA.waitForRun()
    await watcher.waitForTypeCount(`state:notice`, 1)

    await childB.send(`insert item-b beta`, { from: `user` })
    await childB.waitForRun()

    const watcherHistory = await watcher.waitForTypeCount(`state:notice`, 2)

    expect(
      watcherHistory.events
        .filter((event) => event.type === `state:notice`)
        .map((event) => eventValueRecord(event)?.text)
        .sort()
    ).toEqual([`insert:items:item-a:alpha`, `insert:items:item-b:beta`].sort())
  }, 30_000)
})

// ══════════════════════════════════════════════════════════════════════
// Findings verification tests
// ══════════════════════════════════════════════════════════════════════

describe(`N: wake primitives verification`, () => {
  it(`N1: WakeEvent type is "wake" when parent is re-woken by child completion`, async () => {
    // Finding 1: enrichPayload always sets triggerEvent: "message_received".
    // The fix: the runtime reads wake events from its own stream catch-up
    // events instead of relying on the webhook notification field.
    //
    // The parent records wake.type to a state collection on EVERY wake.
    // After the child completes, the parent should eventually see a
    // wake_log_entry with wakeType === "wake". Intermediate re-wakes
    // from the parent's own writes may happen first with "message_received".

    const parent = await t.spawn(TYPES.n1WakeTypeParent, `wake-type-1`)

    // First wake: parent spawns and observes child with wake
    await parent.send(`spawn_and_observe wt-child-1`, { from: `user` })
    await parent.waitForRun()

    // The child should complete its run
    const child = t.entity(`/${TYPES.n1WakeTypeChild}/wt-child-1`)
    await child.waitForRun()

    // Wait for a wake_log_entry with wakeType === "wake" to appear.
    // The parent may get intermediate re-wakes from its own writes
    // before the child completion wake arrives.
    const parentHistory = await parent.waitFor(
      (history) =>
        history.events.some(
          (event) =>
            event.type === `wake_log_entry` &&
            eventValueRecord(event)?.wakeType === `wake`
        ),
      15_000
    )

    const wakeLogEntries = parentHistory.events
      .filter((event) => event.type === `wake_log_entry`)
      .map((event) => eventValueRecord(event))
      .filter((event): event is Record<string, unknown> => event !== undefined)

    // First entry should be from the initial send
    expect(wakeLogEntries[0]!.wakeType).toBe(`message_received`)

    // At least one entry should have wakeType === "wake"
    const wakeEntry = wakeLogEntries.find((e) => e.wakeType === `wake`)
    expect(wakeEntry).toBeDefined()
    expect(wakeEntry!.wakeType).toBe(`wake`)
  }, 30_000)

  it(`N2: observe(db(...)) with wake option triggers re-wake on shared state write`, async () => {
    // Finding 2: ctx.observe(db(id, schema), { wake }) now calls
    // registerWake(), and the server evaluates wakes for shared-state
    // stream appends. The subscriber should be re-woken when shared
    // state changes.

    const ssId = `ss-n2-test`

    // First: spawn the writer with the ssId arg so it creates shared state in handler setup
    const writer = await t.spawn(TYPES.n2SsWakeWriter, `ss-writer-n2`, {
      ssId,
    })
    await writer.send(`write item-1 alpha`, { from: `user` })
    await writer.waitForRun()

    // Spawn the subscriber that connects to the shared state with wake
    const subscriber = await t.spawn(TYPES.n2SsWakeSubscriber, `ss-sub-n2`, {
      ssId,
    })
    await subscriber.send(`check`, { from: `user` })
    await subscriber.waitForRun()

    // Now have the writer write again — this should trigger a wake for the subscriber
    await writer.send(`write item-2 beta`, { from: `user` })

    // Wait for the subscriber to get a wake_log entry with wakeType === "wake"
    // (indicating the handler ran due to a shared-state wake).
    const subscriberHistory = await subscriber.waitFor(
      (history) =>
        history.events.some(
          (event) =>
            event.type === `ss_wake_log` &&
            eventValueRecord(event)?.wakeType === `wake`
        ),
      10_000
    )

    const wakeEntries = subscriberHistory.events
      .filter((event) => event.type === `ss_wake_log`)
      .map((event) => eventValueRecord(event))
      .filter((event): event is Record<string, unknown> => event !== undefined)

    const wakeEntry = wakeEntries.find((e) => e.wakeType === `wake`)
    expect(wakeEntry).toBeDefined()
  }, 30_000)

  it(`N4: ctx.agent.run receives the wake payload and performs a second run on child completion`, async () => {
    const parent = await t.spawn(TYPES.n3IdleWakeParent, `wake-agent-1`)
    await parent.send(`spawn wake-agent-child-1`, { from: `user` })
    await parent.waitForRun()

    const child = t.entity(`/${TYPES.n3IdleWakeChild}/wake-agent-child-1`)
    await child.waitForRun()

    const parentAfterWake = await parent.waitForRunCount(2, 10_000)
    const wakeDrivenDelta = parentAfterWake.find(`text_delta`, (event) => {
      const delta = String(eventValueRecord(event)?.delta ?? ``)
      return (
        delta.includes(`"type":"wake"`) &&
        delta.includes(`wake.type=wake`) &&
        delta.includes(`/${TYPES.n3IdleWakeChild}/wake-agent-child-1`)
      )
    })

    expect(wakeDrivenDelta?.value).toMatchObject({
      delta: expect.stringContaining(`"type":"wake"`),
    })
    expect(wakeDrivenDelta?.value).toMatchObject({
      delta: expect.stringContaining(`wake.type=wake`),
    })
  }, 30_000)

  it(`N5: runFinished wake records the finished child on the parent stream`, async () => {
    const parentId = `wake-summary-1`
    const parent = await t.spawn(TYPES.n4WakeSummaryParent, parentId)
    await parent.send(`spawn trio`, { from: `user` })
    await parent.waitForRun()

    const alphaUrl = `/${TYPES.n4WakeSummaryChild}/${parentId}-alpha`
    const bravoUrl = `/${TYPES.n4WakeSummaryChild}/${parentId}-bravo`
    const charlieUrl = `/${TYPES.n4WakeSummaryChild}/${parentId}-charlie`
    const childUrls = new Set([alphaUrl, bravoUrl, charlieUrl])

    const parentHistory = await parent.waitFor(
      (history) =>
        history.some(`wake`, (event) => {
          const value = eventValueRecord(event)
          const finishedChild = value?.finished_child as
            | Record<string, unknown>
            | undefined
          return typeof finishedChild?.url === `string`
        }),
      15_000
    )

    const wakeEvent = parentHistory.find(`wake`, (event) => {
      const value = eventValueRecord(event)
      const finishedChild = value?.finished_child as
        | Record<string, unknown>
        | undefined
      return typeof finishedChild?.url === `string`
    })
    const wakeValue = eventValueRecord(wakeEvent ?? {}) ?? {}
    const finishedChild = wakeValue.finished_child as
      | Record<string, unknown>
      | undefined
    const finishedUrl =
      typeof finishedChild?.url === `string` ? finishedChild.url : ``

    expect(wakeValue).toMatchObject({
      timestamp: expect.any(String),
      source: finishedUrl,
      finished_child: {
        url: finishedUrl,
        type: TYPES.n4WakeSummaryChild,
        run_status: `completed`,
      },
    })
    expect(childUrls.has(finishedUrl)).toBe(true)
  }, 30_000)

  it(`N3: wake events are delivered as wake when the parent is re-woken`, async () => {
    // The parent records wake.type on every wake.
    //
    // With idleTimeout=0, the parent's handler finishes and releases the wake
    // immediately. The child's completion appends a wake event to the parent
    // stream, and the server re-wakes the parent from that event.
    //
    // We verify both parts:
    // 1. The wake event is present in the parent's stream.
    // 2. The re-wake observes wake.type === "wake".

    const parent = await t.spawn(TYPES.n1WakeTypeParent, `idle-test-1`)
    await parent.send(`spawn_and_observe idle-test-child-1`, { from: `user` })
    await parent.waitForRun()

    const child = t.entity(`/${TYPES.n1WakeTypeChild}/idle-test-child-1`)
    await child.waitForRun()

    // Verify the wake event IS delivered to the parent's stream
    const parentHistory = await parent.waitFor(
      (history) => history.some(`wake`),
      10_000
    )
    expect(parentHistory.some(`wake`)).toBe(true)

    // With idleTimeout=0, the parent's handler finishes and releases the wake
    // immediately. The child's completion fires evaluateWakes, which appends
    // the wake event to the parent's stream. The server sees pending work
    // and re-wakes the parent.
    //
    // Wait for the second wake_log_entry (recorded by the handler on re-wake).
    const parentAfterRewake = await parent.waitForTypeCount(
      `wake_log_entry`,
      2,
      { timeoutMs: 10_000 }
    )

    const wakeLogEntries = parentAfterRewake.events
      .filter((event) => event.type === `wake_log_entry`)
      .map((event) => eventValueRecord(event))

    expect(wakeLogEntries.length).toBeGreaterThanOrEqual(2)
    expect(wakeLogEntries[1]!.wakeType).toBe(`wake`)
  }, 30_000)
})
