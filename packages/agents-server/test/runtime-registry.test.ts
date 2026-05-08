import { describe, expect, it } from 'vitest'
import { createRuntimeRegistry } from '../src/runtime-registry'

describe(`runtime-registry`, () => {
  it(`accumulates types across single-type registrations under one runtime`, () => {
    // Producers POST entity types one at a time. The registry must
    // merge them so /api/runtimes shows the full set, not just the
    // most recent one.
    const reg = createRuntimeRegistry()
    reg.register({ name: `r1`, publicUrl: `http://h:1`, types: [`horton`] })
    reg.register({ name: `r1`, publicUrl: `http://h:1`, types: [`worker`] })
    reg.register({ name: `r1`, publicUrl: `http://h:1`, types: [`chat`] })
    expect(reg.list()).toEqual([
      {
        name: `r1`,
        publicUrl: `http://h:1`,
        types: [`horton`, `worker`, `chat`],
      },
    ])
  })

  it(`dedupes types so re-registering a known type is a no-op`, () => {
    const reg = createRuntimeRegistry()
    reg.register({ name: `r1`, publicUrl: `http://h:1`, types: [`horton`] })
    reg.register({ name: `r1`, publicUrl: `http://h:1`, types: [`horton`] })
    reg.register({
      name: `r1`,
      publicUrl: `http://h:1`,
      types: [`worker`, `horton`],
    })
    expect(reg.list()).toEqual([
      { name: `r1`, publicUrl: `http://h:1`, types: [`horton`, `worker`] },
    ])
  })

  it(`updates publicUrl to the latest write while preserving merged types`, () => {
    // A runtime restarting on a new port re-POSTs its types. The
    // newest publicUrl must win (so /api/runtimes points at the live
    // process), but the type list must not regress.
    const reg = createRuntimeRegistry()
    reg.register({ name: `r1`, publicUrl: `http://h:1`, types: [`horton`] })
    reg.register({ name: `r1`, publicUrl: `http://h:1`, types: [`worker`] })
    reg.register({ name: `r1`, publicUrl: `http://h:2`, types: [`horton`] })
    expect(reg.list()).toEqual([
      { name: `r1`, publicUrl: `http://h:2`, types: [`horton`, `worker`] },
    ])
  })

  it(`isolates types across distinct runtime names`, () => {
    const reg = createRuntimeRegistry()
    reg.register({ name: `r1`, publicUrl: `http://h:1`, types: [`horton`] })
    reg.register({ name: `r2`, publicUrl: `http://h:2`, types: [`worker`] })
    expect(reg.list()).toEqual([
      { name: `r1`, publicUrl: `http://h:1`, types: [`horton`] },
      { name: `r2`, publicUrl: `http://h:2`, types: [`worker`] },
    ])
  })

  it(`omits entries with no publicUrl`, () => {
    const reg = createRuntimeRegistry()
    reg.register({ name: `r1`, types: [`horton`] })
    expect(reg.list()).toEqual([])
  })
})
