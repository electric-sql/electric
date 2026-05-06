import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { watchConfig } from './watcher'

describe(`watchConfig`, () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), `mcp-`))
    file = path.join(dir, `mcp.json`)
    await fs.writeFile(file, `{ "servers": {} }`)
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it(`fires onChange after debounce when file is rewritten`, async () => {
    const onChange = vi.fn()
    const stop = await watchConfig(file, { onChange, debounceMs: 50 })
    try {
      await fs.writeFile(
        file,
        `{ "servers": { "a": { "transport": "stdio", "command": "true" } } }`
      )
      await new Promise((r) => setTimeout(r, 200))
      expect(onChange).toHaveBeenCalled()
      const cfg = onChange.mock.calls[onChange.mock.calls.length - 1]![0]
      expect(cfg.servers.length).toBe(1)
    } finally {
      stop()
    }
  })

  it(`reports parse errors via onError without throwing`, async () => {
    const onChange = vi.fn()
    const onError = vi.fn()
    const stop = await watchConfig(file, { onChange, onError, debounceMs: 50 })
    try {
      await fs.writeFile(file, `not json`)
      await new Promise((r) => setTimeout(r, 200))
      expect(onError).toHaveBeenCalled()
    } finally {
      stop()
    }
  })
})
