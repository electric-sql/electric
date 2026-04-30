import { describe, it, expect } from 'vitest'
import { LocalDockerProvider } from '../../src/providers/local-docker'

describe(`LocalDockerProvider construction`, () => {
  it(`exposes name "local-docker"`, () => {
    const p = new LocalDockerProvider()
    expect(p.name).toBe(`local-docker`)
  })
})
