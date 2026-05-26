import { describe, expect, it } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import {
  WatcherSchema,
  ManagedPrRow,
} from '../../src/agents/pr-shared/watcher-schema'

describe(`WatcherSchema`, () => {
  it(`exposes a managed_prs collection with key + schema`, () => {
    expect(WatcherSchema.managed_prs).toBeDefined()
    expect(WatcherSchema.managed_prs.primaryKey).toBe(`key`)
  })

  it(`accepts a well-formed managed-pr row`, () => {
    const row = {
      key: `42`,
      number: 42,
      manager_entity_url: `http://localhost:4437/pr-manager/abc/main`,
      state: `active` as const,
      spawned_at: `2026-05-09T00:00:00Z`,
    }
    expect(Value.Check(ManagedPrRow, row)).toBe(true)
  })

  it(`rejects unknown state values`, () => {
    const row = {
      key: `1`,
      number: 1,
      manager_entity_url: `x`,
      state: `banana`,
      spawned_at: `z`,
    }
    expect(Value.Check(ManagedPrRow, row)).toBe(false)
  })
})
