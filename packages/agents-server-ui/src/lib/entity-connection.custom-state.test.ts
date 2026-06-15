import { describe, expect, it } from 'vitest'
import { COMMENTS_CONTRACT } from '@electric-ax/agents-runtime/client'
import { uiCustomStateForEntity } from './entity-connection'

describe(`uiCustomStateForEntity`, () => {
  it(`registers comments when the type advertises the comments contract`, () => {
    const customState = uiCustomStateForEntity({
      comments: { type: `state:comments`, contract: COMMENTS_CONTRACT },
    })
    expect(customState.comments).toBeDefined()
    expect(customState.comments!.type).toBe(`state:comments`)
    expect(customState.comments!.externallyWritable).toBe(true)
  })

  it(`registers nothing when the type declares no writable collections`, () => {
    expect(uiCustomStateForEntity(undefined)).toEqual({})
    expect(uiCustomStateForEntity(null)).toEqual({})
    expect(uiCustomStateForEntity({})).toEqual({})
  })

  it(`ignores a comments entry without the canonical contract`, () => {
    expect(
      uiCustomStateForEntity({ comments: { type: `state:comments` } })
    ).toEqual({})
  })
})
