import { afterEach, describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import {
  ensureAnthropicApiKey,
  parsePastedAnthropicApiKey,
  type PromptIO,
} from '../src/prompt-api-key'

interface FakeIO {
  io: PromptIO
  output: () => string
  cwd: string
  exitCalls: Array<number>
  validationCalls: Array<string>
  cleanup: () => void
}

function createFakeIO({
  inputLines,
  isTTY = true,
  validateAnthropicApiKey,
}: {
  inputLines: Array<string>
  isTTY?: boolean
  validateAnthropicApiKey?: (key: string) => Promise<void>
}): FakeIO {
  const cwd = mkdtempSync(join(tmpdir(), `electric-ax-prompt-`))
  const input = new PassThrough()
  const output = new PassThrough()
  let outputBuffer = ``
  let promptsSeen = 0
  let linesFed = 0
  const queue = [...inputLines]

  output.on(`data`, (chunk: Buffer) => {
    const text = chunk.toString(`utf8`)
    outputBuffer += text
    for (const _match of text.matchAll(/: $/gm)) {
      void _match
      promptsSeen += 1
    }
    while (linesFed < promptsSeen && linesFed < queue.length) {
      const line = queue[linesFed]!
      linesFed += 1
      setImmediate(() => input.write(`${line}\n`))
    }
  })

  const exitCalls: Array<number> = []
  const exit = ((code: number) => {
    exitCalls.push(code)
    throw new Error(`__exit__:${code}`)
  }) as (code: number) => never
  const validationCalls: Array<string> = []
  const validator = async (key: string): Promise<void> => {
    validationCalls.push(key)
    await validateAnthropicApiKey?.(key)
  }

  return {
    io: {
      input,
      output,
      isTTY,
      cwd,
      exit,
      validateAnthropicApiKey: validator,
    },
    output: () => outputBuffer,
    cwd,
    exitCalls,
    validationCalls,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  }
}

describe(`parsePastedAnthropicApiKey`, () => {
  it(`accepts raw keys and environment-style pasted lines`, () => {
    expect(parsePastedAnthropicApiKey(`sk-ant-raw`)).toBe(`sk-ant-raw`)
    expect(parsePastedAnthropicApiKey(`ANTHROPIC_API_KEY=sk-ant-equals`)).toBe(
      `sk-ant-equals`
    )
    expect(parsePastedAnthropicApiKey(`ANTHROPIC_API_KEY: sk-ant-colon`)).toBe(
      `sk-ant-colon`
    )
    expect(
      parsePastedAnthropicApiKey(`export ANTHROPIC_API_KEY="sk-ant-quoted"`)
    ).toBe(`sk-ant-quoted`)
  })
})

describe(`ensureAnthropicApiKey`, () => {
  let cleanups: Array<() => void> = []
  const originalApiKey = process.env.ANTHROPIC_API_KEY

  afterEach(() => {
    for (const cleanup of cleanups) cleanup()
    cleanups = []
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey
    }
  })

  it(`returns the explicit option key without prompting`, async () => {
    const fake = createFakeIO({ inputLines: [] })
    cleanups.push(fake.cleanup)

    const key = await ensureAnthropicApiKey(
      { anthropicApiKey: `sk-ant-explicit` },
      fake.io
    )

    expect(key).toBe(`sk-ant-explicit`)
    expect(fake.output()).toBe(``)
    expect(fake.validationCalls).toEqual([`sk-ant-explicit`])
  })

  it(`rethrows the original error when stdin is not a TTY`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({ inputLines: [], isTTY: false })
    cleanups.push(fake.cleanup)

    await expect(ensureAnthropicApiKey({}, fake.io)).rejects.toThrow(
      /ANTHROPIC_API_KEY/
    )
    expect(fake.output()).toBe(``)
  })

  it(`exits cleanly when the user presses enter to cancel`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({ inputLines: [``] })
    cleanups.push(fake.cleanup)

    await expect(ensureAnthropicApiKey({}, fake.io)).rejects.toThrow(
      `__exit__:0`
    )

    expect(fake.exitCalls).toEqual([0])
    expect(fake.output()).toContain(`never leaves your local computer`)
    expect(fake.output()).toContain(`Provide an Anthropic Claude key`)
    expect(fake.output()).toContain(
      `Support for other LLM providers is coming soon`
    )
    expect(fake.output()).toContain(`Paste the Anthropic key`)
    expect(fake.output()).not.toContain(`Paste the raw key`)
    expect(fake.output()).not.toContain(`preview release`)
    expect(fake.output()).not.toContain(`very soon`)
    expect(fake.output()).toContain(`Cancelled`)
    expect(existsSync(join(fake.cwd, `.env`))).toBe(false)
  })

  it(`prompts without showing an error when no key is configured`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({ inputLines: [``] })
    cleanups.push(fake.cleanup)

    await expect(ensureAnthropicApiKey({}, fake.io)).rejects.toThrow(
      `__exit__:0`
    )

    expect(fake.output()).toContain(`Provide an Anthropic Claude key`)
    expect(fake.output()).not.toContain(`Could not use that Anthropic key`)
    expect(fake.output()).not.toContain(`ANTHROPIC_API_KEY is required`)
  })

  it(`writes a directly pasted key to a new .env`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({ inputLines: [`sk-ant-pasted`] })
    cleanups.push(fake.cleanup)

    const key = await ensureAnthropicApiKey({}, fake.io)

    expect(key).toBe(`sk-ant-pasted`)
    expect(process.env.ANTHROPIC_API_KEY).toBe(`sk-ant-pasted`)

    const envContent = readFileSync(join(fake.cwd, `.env`), `utf8`)
    expect(envContent).toBe(`ANTHROPIC_API_KEY=sk-ant-pasted\n`)
    expect(fake.validationCalls).toEqual([`sk-ant-pasted`])
  })

  it(`accepts an ANTHROPIC_API_KEY-prefixed pasted key`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({
      inputLines: [`ANTHROPIC_API_KEY: sk-ant-prefixed`],
    })
    cleanups.push(fake.cleanup)

    const key = await ensureAnthropicApiKey({}, fake.io)

    expect(key).toBe(`sk-ant-prefixed`)
    expect(process.env.ANTHROPIC_API_KEY).toBe(`sk-ant-prefixed`)

    const envContent = readFileSync(join(fake.cwd, `.env`), `utf8`)
    expect(envContent).toBe(`ANTHROPIC_API_KEY=sk-ant-prefixed\n`)
  })

  it(`appends the key to an existing .env without an ANTHROPIC_API_KEY entry`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({ inputLines: [`sk-ant-new`] })
    cleanups.push(fake.cleanup)

    writeFileSync(join(fake.cwd, `.env`), `OTHER=value\n`, `utf8`)

    await ensureAnthropicApiKey({}, fake.io)

    const envContent = readFileSync(join(fake.cwd, `.env`), `utf8`)
    expect(envContent).toBe(`OTHER=value\nANTHROPIC_API_KEY=sk-ant-new\n`)
  })

  it(`replaces an existing empty ANTHROPIC_API_KEY line in .env`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({ inputLines: [`sk-ant-fresh`] })
    cleanups.push(fake.cleanup)

    writeFileSync(
      join(fake.cwd, `.env`),
      `OTHER=value\nANTHROPIC_API_KEY=\nANOTHER=foo\n`,
      `utf8`
    )

    await ensureAnthropicApiKey({}, fake.io)

    const envContent = readFileSync(join(fake.cwd, `.env`), `utf8`)
    expect(envContent).toBe(
      `OTHER=value\nANTHROPIC_API_KEY=sk-ant-fresh\nANOTHER=foo\n`
    )
  })

  it(`reprompts after an invalid pasted key before writing .env`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({
      inputLines: [`sk-ant-invalid`, `sk-ant-valid`],
      validateAnthropicApiKey: async (key) => {
        if (key === `sk-ant-invalid`) {
          throw new Error(`invalid key`)
        }
      },
    })
    cleanups.push(fake.cleanup)

    const key = await ensureAnthropicApiKey({}, fake.io)

    expect(key).toBe(`sk-ant-valid`)
    expect(fake.output()).toContain(`Could not use that Anthropic key`)
    expect(fake.validationCalls).toEqual([`sk-ant-invalid`, `sk-ant-valid`])
    expect(readFileSync(join(fake.cwd, `.env`), `utf8`)).toBe(
      `ANTHROPIC_API_KEY=sk-ant-valid\n`
    )
  })

  it(`reprompts when a pasted key does not look like an Anthropic key`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({
      inputLines: [`sk-openai-not-anthropic`, `sk-ant-valid`],
    })
    cleanups.push(fake.cleanup)

    const key = await ensureAnthropicApiKey({}, fake.io)

    expect(key).toBe(`sk-ant-valid`)
    expect(fake.output()).toContain(`expected it to start with sk-ant-`)
    expect(fake.validationCalls).toEqual([`sk-ant-valid`])
  })

  it(`rejects an invalid key resolved from options without prompting`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({
      inputLines: [],
      validateAnthropicApiKey: async () => {
        throw new Error(`invalid key`)
      },
    })
    cleanups.push(fake.cleanup)

    await expect(
      ensureAnthropicApiKey({ anthropicApiKey: `sk-ant-invalid` }, fake.io)
    ).rejects.toThrow(/invalid key/)
    expect(fake.output()).toBe(``)
    expect(fake.validationCalls).toEqual([`sk-ant-invalid`])
  })

  it(`prompts after a resolved key fails validation in an interactive terminal`, async () => {
    process.env.ANTHROPIC_API_KEY = `sk-ant-stale`
    const fake = createFakeIO({
      inputLines: [`sk-ant-fresh`],
      validateAnthropicApiKey: async (key) => {
        if (key === `sk-ant-stale`) {
          throw new Error(`invalid key`)
        }
      },
    })
    cleanups.push(fake.cleanup)

    const key = await ensureAnthropicApiKey({}, fake.io)

    expect(key).toBe(`sk-ant-fresh`)
    expect(fake.validationCalls).toEqual([`sk-ant-stale`, `sk-ant-fresh`])
    expect(readFileSync(join(fake.cwd, `.env`), `utf8`)).toBe(
      `ANTHROPIC_API_KEY=sk-ant-fresh\n`
    )
  })
})
