import { describe, expect, it } from 'vitest'
import { createRuntimeRegistry } from '../src/runtime-registry'

describe(`runtime-registry`, () => {
  it(`register stores (name, publicUrl, types) and replaces on re-registration`, () => {
    const reg = createRuntimeRegistry()
    reg.register({ name: `r1`, publicUrl: `http://h:1`, types: [`horton`] })
    reg.register({
      name: `r1`,
      publicUrl: `http://h:2`,
      types: [`horton`, `worker`],
    })
    expect(reg.list()).toEqual([
      { name: `r1`, publicUrl: `http://h:2`, types: [`horton`, `worker`] },
    ])
  })

  it(`omits entries with no publicUrl`, () => {
    const reg = createRuntimeRegistry()
    reg.register({ name: `r1`, types: [`horton`] })
    expect(reg.list()).toEqual([])
  })
})
