import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { HandlerContext, WakeEvent } from './types'

export type InboxSchemas = Record<string, StandardSchemaV1<any, any>>

type InferOutput<TSchema> =
  TSchema extends StandardSchemaV1<any, infer TOutput> ? TOutput : never

export type InboxEvent<
  TInbox extends InboxSchemas,
  TType extends keyof TInbox & string,
> = {
  kind: `inbox`
  type: TType
  payload: InferOutput<TInbox[TType]>
  rawPayload: unknown
  wake: WakeEvent
}

export type InboxHandler<
  TInbox extends InboxSchemas,
  TType extends keyof TInbox & string,
> = (
  ctx: HandlerContext,
  event: InboxEvent<TInbox, TType>
) => void | Promise<void>

export type InboxHandlerMap<TInbox extends InboxSchemas> = {
  [K in keyof TInbox & string]?: InboxHandler<TInbox, K>
}

export type InboxHandlerRouter = {
  handle(ctx: HandlerContext, wake: WakeEvent): Promise<boolean>
}

export function defineInboxHandlers<TInbox extends InboxSchemas>(
  inbox: TInbox,
  handlers: InboxHandlerMap<TInbox>
): InboxHandlerRouter {
  return {
    async handle(ctx, wake) {
      if (wake.type !== `inbox`) return false

      const messageType = wake.summary
      if (!messageType || !(messageType in inbox)) return false

      const handler = handlers[messageType]
      if (!handler) return false

      const schema = inbox[messageType]
      const result = await schema[`~standard`].validate(wake.payload)

      if (result.issues) {
        throw new Error(
          `Invalid inbox payload for "${messageType}": ${formatIssues(result.issues)}`
        )
      }

      await (handler as InboxHandler<TInbox, keyof TInbox & string>)(ctx, {
        kind: `inbox`,
        type: messageType,
        payload: result.value,
        rawPayload: wake.payload,
        wake,
      } as InboxEvent<TInbox, keyof TInbox & string>)

      return true
    },
  }
}

function formatIssues(issues: ReadonlyArray<StandardSchemaV1.Issue>): string {
  return issues
    .map((issue) => {
      const path = issue.path?.map(pathSegmentKey).join(`.`)
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join(`; `)
}

function pathSegmentKey(
  segment: PropertyKey | StandardSchemaV1.PathSegment
): string {
  const key =
    typeof segment === `object` && segment !== null && `key` in segment
      ? segment.key
      : segment
  return String(key)
}
