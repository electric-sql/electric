import { describe, expect, it } from 'vitest'
import { parseSlashCommand } from '../../src/agents/pr-shared/slash-commands'

describe(`parseSlashCommand`, () => {
  it(`parses /continue <role>`, () => {
    expect(parseSlashCommand(`/continue reviewer`)).toEqual({
      kind: `continue`,
      role: `reviewer`,
    })
    expect(parseSlashCommand(`/continue build-doctor`)).toEqual({
      kind: `continue`,
      role: `build-doctor`,
    })
    expect(parseSlashCommand(`/continue doc-editor`)).toEqual({
      kind: `continue`,
      role: `doc-editor`,
    })
  })
  it(`parses /continue all`, () => {
    expect(parseSlashCommand(`/continue all`)).toEqual({
      kind: `continue`,
      role: `all`,
    })
  })
  it(`parses /stop and /resume`, () => {
    expect(parseSlashCommand(`/stop`)).toEqual({ kind: `stop` })
    expect(parseSlashCommand(`/resume`)).toEqual({ kind: `resume` })
  })
  it(`is case-insensitive`, () => {
    expect(parseSlashCommand(`/CONTINUE Reviewer`)).toEqual({
      kind: `continue`,
      role: `reviewer`,
    })
  })
  it(`matches first valid line in a multi-line comment`, () => {
    expect(parseSlashCommand(`hello\n/stop\nthanks`)).toEqual({ kind: `stop` })
  })
  it(`returns null for unknown role`, () => {
    expect(parseSlashCommand(`/continue manager`)).toBeNull()
  })
  it(`returns null when no command present`, () => {
    expect(parseSlashCommand(`looks good to me`)).toBeNull()
  })
  it(`does not match commands embedded mid-line`, () => {
    expect(parseSlashCommand(`See /stop later`)).toBeNull()
  })
})
