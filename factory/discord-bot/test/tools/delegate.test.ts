import { describe, it, expect, vi } from 'vitest'
import { createSpawnHortonTool } from '../../src/tools/delegate'

describe(`spawn_horton`, () => {
  it(`spawns a Horton child via runtime-server-client`, async () => {
    const spawnEntity = vi.fn().mockResolvedValue({
      entityUrl: `http://a/horton-xyz`,
      streamPath: `/x`,
    })
    const tool = createSpawnHortonTool({
      runtime: { spawnEntity } as any,
      hortonEntityType: `horton`,
      threadId: `t1`,
      defaultRepo: `o/r`,
      parentUrl: `http://a/discord-bot-t1`,
    })

    const result = await tool.execute(`c`, {
      task: `fix issue 4312`,
      initialMessage: `start`,
      branch: `electric-bot/thread-t1`,
    })

    expect(spawnEntity).toHaveBeenCalledTimes(1)
    const call = spawnEntity.mock.calls[0][0]
    expect(call.type).toBe(`horton`)
    expect(call.parentUrl).toBe(`http://a/discord-bot-t1`)
    expect(call.initialMessage).toBe(`start`)
    expect(call.args.task).toBe(`fix issue 4312`)
    expect(call.args.repo).toBe(`o/r`)
    expect(call.args.branch).toBe(`electric-bot/thread-t1`)
    expect(call.wake?.condition).toBe(`runFinished`)
    expect(result.details).toMatchObject({
      childEntityUrl: `http://a/horton-xyz`,
    })
  })
})
