import { afterEach, describe, expect, it, vi } from 'vitest'

const runtimeDb = {
  preload: vi.fn(),
  close: vi.fn(),
}
const createRuntimeEntityStreamDB = vi.fn(() => runtimeDb)

vi.mock(`@electric-ax/agents-runtime`, () => ({
  appendPathToUrl: (baseUrl: string, path: string) =>
    `${baseUrl.replace(/\/$/, ``)}/${path.replace(/^\//, ``)}`,
  createEntityStreamDB: createRuntimeEntityStreamDB,
}))

describe(`createEntityStreamDB`, () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it(`uses the agents-runtime StreamDB helper so row timeline ordering matches the UI`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ streams: { main: `/horton/demo/main` } }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )
    runtimeDb.preload.mockResolvedValue(undefined)

    const { createEntityStreamDB } = await import(`../src/entity-stream-db`)
    const result = await createEntityStreamDB({
      baseUrl: `http://localhost:4437`,
      entityUrl: `/horton/demo`,
      initialOffset: `42`,
      headers: { 'electric-principal': `user:kyle` },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:4437/_electric/entities/horton/demo`,
      {
        headers: {
          'content-type': `application/json`,
          'electric-principal': `user:kyle`,
        },
      }
    )
    expect(createRuntimeEntityStreamDB).toHaveBeenCalledWith(
      `http://localhost:4437/horton/demo/main`,
      undefined,
      undefined,
      {
        streamOptions: {
          headers: {
            'content-type': `application/json`,
            'electric-principal': `user:kyle`,
          },
          offset: `42`,
        },
      }
    )
    expect(runtimeDb.preload).toHaveBeenCalledOnce()

    result.close()
    expect(runtimeDb.close).toHaveBeenCalledOnce()
  })
})
