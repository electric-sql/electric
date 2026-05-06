import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { watchConfig } from '../../src/config/watcher'

describe(`watchConfig`, () => {
  let dir = ``
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), `mcp-`))
  })

  it(`emits initial + change events with debounce`, async () => {
    const path = join(dir, `mcp.json`)
    await writeFile(path, JSON.stringify({ servers: {} }))
    const events: string[] = []
    const stop = watchConfig(
      path,
      (cfg) => {
        events.push(Object.keys(cfg.servers).join(`,`) || `empty`)
      },
      { debounceMs: 50 }
    )

    await new Promise((r) => setTimeout(r, 100)) // initial load
    await writeFile(
      path,
      JSON.stringify({
        servers: {
          a: {
            transport: `http`,
            url: `http://x`,
            auth: { mode: `apiKey`, headerName: `X`, valueRef: `v` },
          },
        },
      })
    )
    await new Promise((r) => setTimeout(r, 200))

    stop()
    expect(events).toEqual([`empty`, `a`])
  })
})
