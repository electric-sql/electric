import { entityStateSchema } from '../../src/entity-schema'
import type { ChangeEvent } from '@durable-streams/state'

type Operation = `insert` | `update`
const FIXED_TIMESTAMP = `2026-03-20T00:00:00.000Z`

export function ev(
  type: string,
  key: string,
  operation: Operation,
  value: Record<string, unknown> = {},
  headers: Record<string, unknown> = {}
): ChangeEvent {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([headerKey, headerValue]) => [
      headerKey,
      String(headerValue),
    ])
  )

  switch (type) {
    case `message_received`:
      return entityStateSchema.inbox.insert({
        key,
        value: {
          from: `user`,
          timestamp: FIXED_TIMESTAMP,
          ...value,
        } as never,
        headers: normalizedHeaders,
      }) as ChangeEvent

    case `wake`:
      return entityStateSchema.wakes.insert({
        key,
        value: {
          timestamp: FIXED_TIMESTAMP,
          source: `/child/c1`,
          timeout: false,
          changes: [],
          ...value,
        } as never,
        headers: normalizedHeaders,
      }) as ChangeEvent

    case `run`:
      return (
        operation === `insert`
          ? entityStateSchema.runs.insert({
              key,
              value: value as never,
              headers: normalizedHeaders,
            })
          : entityStateSchema.runs.update({
              key,
              value: value as never,
              headers: normalizedHeaders,
            })
      ) as ChangeEvent

    case `step`:
      return (
        operation === `insert`
          ? entityStateSchema.steps.insert({
              key,
              value: value as never,
              headers: normalizedHeaders,
            })
          : entityStateSchema.steps.update({
              key,
              value: value as never,
              headers: normalizedHeaders,
            })
      ) as ChangeEvent

    case `text`:
      return (
        operation === `insert`
          ? entityStateSchema.texts.insert({
              key,
              value: value as never,
              headers: normalizedHeaders,
            })
          : entityStateSchema.texts.update({
              key,
              value: value as never,
              headers: normalizedHeaders,
            })
      ) as ChangeEvent

    case `text_delta`:
      return entityStateSchema.textDeltas.insert({
        key,
        value: value as never,
        headers: normalizedHeaders,
      }) as ChangeEvent

    case `tool_call`:
      return (
        operation === `insert`
          ? entityStateSchema.toolCalls.insert({
              key,
              value: value as never,
              headers: normalizedHeaders,
            })
          : entityStateSchema.toolCalls.update({
              key,
              value: value as never,
              headers: normalizedHeaders,
            })
      ) as ChangeEvent

    case `child_status`:
      return (
        operation === `insert`
          ? entityStateSchema.childStatus.insert({
              key,
              value: {
                entity_url: `/test/child-1`,
                entity_type: `test-child`,
                status: `unknown`,
                ...value,
              } as never,
              headers: normalizedHeaders,
            })
          : entityStateSchema.childStatus.update({
              key,
              value: {
                entity_url: `/test/child-1`,
                entity_type: `test-child`,
                status: `unknown`,
                ...value,
              } as never,
              headers: normalizedHeaders,
            })
      ) as ChangeEvent

    case `manifest`:
      return (
        operation === `insert`
          ? entityStateSchema.manifests.insert({
              key,
              value: value as never,
              headers: normalizedHeaders,
            })
          : entityStateSchema.manifests.update({
              key,
              value: value as never,
              headers: normalizedHeaders,
            })
      ) as ChangeEvent

    case `context_inserted`:
      return entityStateSchema.contextInserted.insert({
        key,
        value: {
          timestamp: FIXED_TIMESTAMP,
          attrs: {},
          name: `context_entry`,
          content: ``,
          id: key,
          ...value,
        } as never,
        headers: normalizedHeaders,
      }) as ChangeEvent

    case `context_removed`:
      return entityStateSchema.contextRemoved.insert({
        key,
        value: {
          timestamp: FIXED_TIMESTAMP,
          id: key,
          name: `context_entry`,
          ...value,
        } as never,
        headers: normalizedHeaders,
      }) as ChangeEvent

    default:
      return {
        type,
        key,
        value,
        headers: { operation, ...normalizedHeaders },
      } as ChangeEvent
  }
}
