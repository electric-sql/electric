import { describe, expect, it } from 'vitest'
import { parsePreamble } from '../src/skills/preamble'

describe(`parsePreamble`, () => {
  it(`extracts all fields from a complete preamble`, () => {
    const content = `---
description: Interactive tutorial guide
whenToUse: User asks about tutorials or getting started
keywords: [tutorial, multi-agent, spawn]
max: 15000
---

# Tutorial content here`

    const result = parsePreamble(content)
    expect(result).toEqual({
      description: `Interactive tutorial guide`,
      whenToUse: `User asks about tutorials or getting started`,
      keywords: [`tutorial`, `multi-agent`, `spawn`],
      max: 15000,
    })
  })

  it(`returns partial result when some fields are missing`, () => {
    const content = `---
description: A deployment guide
---

# Deploy`

    const result = parsePreamble(content)
    expect(result).toEqual({
      description: `A deployment guide`,
    })
  })

  it(`returns empty object when no preamble exists`, () => {
    const content = `# Just a markdown file\n\nNo preamble here.`
    const result = parsePreamble(content)
    expect(result).toEqual({})
  })

  it(`returns empty object when preamble is not closed`, () => {
    const content = `---
description: Unclosed preamble
keywords: [a, b]`

    const result = parsePreamble(content)
    expect(result).toEqual({})
  })

  it(`handles keywords as comma-separated string`, () => {
    const content = `---
description: Test
whenToUse: Test scenario
keywords: alpha, beta, gamma
---
`
    const result = parsePreamble(content)
    expect(result.keywords).toEqual([`alpha`, `beta`, `gamma`])
  })

  it(`handles multi-line YAML keyword arrays`, () => {
    const content = `---
description: A skill
whenToUse: When needed
keywords:
  - tutorial
  - getting started
  - learn
  - multi-agent
max: 10000
---

# Content here`

    const result = parsePreamble(content)
    expect(result.keywords).toEqual([
      `tutorial`,
      `getting started`,
      `learn`,
      `multi-agent`,
    ])
    expect(result.max).toBe(10000)
  })

  it(`strips surrounding quotes from description and whenToUse`, () => {
    const content = `---
description: "Scaffold a new project from scratch"
whenToUse: "User wants to create a new project"
keywords:
  - scaffold
  - new project
---
`
    const result = parsePreamble(content)
    expect(result.description).toBe(`Scaffold a new project from scratch`)
    expect(result.whenToUse).toBe(`User wants to create a new project`)
    expect(result.keywords).toEqual([`scaffold`, `new project`])
  })

  it(`parses arguments and argument-hint`, () => {
    const content = `---
description: A skill with args
whenToUse: When testing args
keywords: [test]
arguments:
  - project_path
  - name
argument-hint: "[path] [name]"
---

# Content`

    const result = parsePreamble(content)
    expect(result.arguments).toEqual([`project_path`, `name`])
    expect(result.argumentHint).toBe(`[path] [name]`)
  })
})
