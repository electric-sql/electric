import type { WikiSpaceSnapshot } from '../shared/space'
import type { WorkerEnv } from './env'
import { getWikiSpaceStore, seedLocalDemoWikiSpace } from './wiki-space-store'
import { getWikiStateProducer } from './wiki-state-producer'

export type SeededDemoResult = {
  space: WikiSpaceSnapshot
  sourceId: string
}

const seededSpace = {
  wikiSpaceId: `wiki_seeded_living_wiki_demo`,
  actorId: `actor_seeded_demo_owner`,
  title: `Seeded Living Wiki Demo`,
  displayName: `Demo Owner`,
  avatarColor: `purple` as const,
  createdAt: `2026-06-03T00:00:00.000Z`,
}

const seededSource = {
  kind: `text` as const,
  title: `Field notes: Electric Agents collaboration`,
  body: `Electric Agents let humans and agents collaborate over a shared substrate. This seeded source is Worker-local demo data for proposing and reviewing a Living Wiki page without fetching external content.`,
}

export async function seedLivingWikiDemo(
  env: WorkerEnv
): Promise<SeededDemoResult> {
  const space = await seedLocalDemoWikiSpace(seededSpace)
  const producer = getWikiStateProducer()
  producer.bootstrapSpace(space)

  const sourceResult = producer.submitSource({
    wikiSpaceId: space.space.id,
    actorId: space.currentActor.id,
    ...seededSource,
  })

  // Re-read via the public store shape so callers only receive safe snapshot data.
  return {
    space: await getWikiSpaceStore(env).getSpace({
      wikiSpaceId: space.space.id,
      actorId: space.currentActor.id,
    }),
    sourceId: sourceResult.source.id,
  }
}
