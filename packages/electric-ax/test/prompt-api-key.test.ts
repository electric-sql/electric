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
import { ensureAnthropicApiKey, type PromptIO } from '../src/prompt-api-key'

interface FakeIO {
  io: PromptIO
  output: () => string
  cwd: string
  exitCalls: Array<number>
  cleanup: () => void
}

function createFakeIO({
  inputLines,
  isTTY = true,
}: {
  inputLines: Array<string>
  isTTY?: boolean
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

  return {
    io: {
      input,
      output,
      isTTY,
      cwd,
      exit,
    },
    output: () => outputBuffer,
    cwd,
    exitCalls,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  }
}

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

  it(`exits cleanly when the user picks manual setup (1)`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({ inputLines: [`1`] })
    cleanups.push(fake.cleanup)

    await expect(ensureAnthropicApiKey({}, fake.io)).rejects.toThrow(
      `__exit__:0`
    )

    expect(fake.exitCalls).toEqual([0])
    expect(fake.output()).toContain(`never leaves your local computer`)
    expect(fake.output()).toContain(`Get a key from`)
    expect(existsSync(join(fake.cwd, `.env`))).toBe(false)
  })

  it(`writes the pasted key to a new .env when the user picks 2`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({ inputLines: [`2`, `sk-ant-pasted`] })
    cleanups.push(fake.cleanup)

    const key = await ensureAnthropicApiKey({}, fake.io)

    expect(key).toBe(`sk-ant-pasted`)
    expect(process.env.ANTHROPIC_API_KEY).toBe(`sk-ant-pasted`)

    const envContent = readFileSync(join(fake.cwd, `.env`), `utf8`)
    expect(envContent).toBe(`ANTHROPIC_API_KEY=sk-ant-pasted\n`)
  })

  it(`appends the key to an existing .env without an ANTHROPIC_API_KEY entry`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({ inputLines: [`2`, `sk-ant-new`] })
    cleanups.push(fake.cleanup)

    writeFileSync(join(fake.cwd, `.env`), `OTHER=value\n`, `utf8`)

    await ensureAnthropicApiKey({}, fake.io)

    const envContent = readFileSync(join(fake.cwd, `.env`), `utf8`)
    expect(envContent).toBe(`OTHER=value\nANTHROPIC_API_KEY=sk-ant-new\n`)
  })

  it(`replaces an existing empty ANTHROPIC_API_KEY line in .env`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({ inputLines: [`2`, `sk-ant-fresh`] })
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

  it(`rejects an empty pasted key`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({ inputLines: [`2`, ``] })
    cleanups.push(fake.cleanup)

    await expect(ensureAnthropicApiKey({}, fake.io)).rejects.toThrow(
      /No API key provided/
    )
  })

  it(`rejects an unrecognized choice`, async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fake = createFakeIO({ inputLines: [`bogus`] })
    cleanups.push(fake.cleanup)

    await expect(ensureAnthropicApiKey({}, fake.io)).rejects.toThrow(
      /Unrecognized choice/
    )
  })
})
