import type {
  DemoActor,
  WikiSpaceSnapshot,
  WikiSpaceSummary,
  CreateSpaceInput,
  JoinSpaceInput,
  GetSpaceInput,
} from '../shared/space'
import type { WorkerEnv } from './env'
import {
  createDemoId,
  normalizeDisplayName,
  normalizeSpaceTitle,
} from './demo-session'

export type CreateSpaceCommand = CreateSpaceInput
export type JoinSpaceCommand = JoinSpaceInput
export type GetSpaceCommand = GetSpaceInput

export type WikiSpaceStore = {
  createSpace(command: CreateSpaceCommand): Promise<WikiSpaceSnapshot>
  joinSpace(command: JoinSpaceCommand): Promise<WikiSpaceSnapshot>
  getSpace(command: GetSpaceCommand): Promise<WikiSpaceSnapshot>
}

type InternalSpaceRecord = {
  space: Omit<WikiSpaceSummary, `memberCount`>
  actors: DemoActor[]
}

const localDemoSpaces = new Map<string, InternalSpaceRecord>()

export class WikiSpaceNotFoundError extends Error {
  constructor(public readonly wikiSpaceId: string) {
    super(`WikiSpace not found: ${wikiSpaceId}`)
    this.name = `WikiSpaceNotFoundError`
  }
}

const createTimestamp = (): string => new Date().toISOString()

const createUniqueId = (prefix: `wiki` | `actor`): string => {
  let id = createDemoId(prefix)

  while (
    prefix === `wiki`
      ? localDemoSpaces.has(id)
      : Array.from(localDemoSpaces.values()).some((record) =>
          record.actors.some((actor) => actor.id === id)
        )
  ) {
    id = createDemoId(prefix)
  }

  return id
}

const toSnapshot = (
  record: InternalSpaceRecord,
  requestedActorId?: string
): WikiSpaceSnapshot => {
  const actors = record.actors.map((actor) => ({ ...actor }))
  const currentActor =
    actors.find((actor) => actor.id === requestedActorId) ?? actors[0]

  if (currentActor === undefined) {
    throw new WikiSpaceNotFoundError(record.space.id)
  }

  return {
    space: {
      ...record.space,
      memberCount: actors.length,
    },
    currentActor,
    actors,
  }
}

const getExistingRecord = (wikiSpaceId: string): InternalSpaceRecord => {
  const record = localDemoSpaces.get(wikiSpaceId)

  if (record === undefined) {
    throw new WikiSpaceNotFoundError(wikiSpaceId)
  }

  return record
}

export class LocalDemoWikiSpaceStore implements WikiSpaceStore {
  async createSpace(command: CreateSpaceCommand): Promise<WikiSpaceSnapshot> {
    const createdAt = createTimestamp()
    const wikiSpaceId = createUniqueId(`wiki`)
    const actorId = createUniqueId(`actor`)
    const actor: DemoActor = {
      id: actorId,
      wikiSpaceId,
      kind: `human`,
      displayName: normalizeDisplayName(command.displayName),
      avatarColor: command.avatarColor,
      createdAt,
    }
    const record: InternalSpaceRecord = {
      space: {
        id: wikiSpaceId,
        title: normalizeSpaceTitle(command.title),
        createdAt,
        createdByActorId: actorId,
      },
      actors: [actor],
    }

    localDemoSpaces.set(wikiSpaceId, record)

    return toSnapshot(record, actorId)
  }

  async joinSpace(command: JoinSpaceCommand): Promise<WikiSpaceSnapshot> {
    const record = getExistingRecord(command.wikiSpaceId)
    const existingActor = command.actorId
      ? record.actors.find((actor) => actor.id === command.actorId)
      : undefined

    if (existingActor !== undefined) {
      existingActor.displayName = normalizeDisplayName(command.displayName)
      existingActor.avatarColor = command.avatarColor

      return toSnapshot(record, existingActor.id)
    }

    const actor: DemoActor = {
      id: command.actorId ?? createUniqueId(`actor`),
      wikiSpaceId: command.wikiSpaceId,
      kind: `human`,
      displayName: normalizeDisplayName(command.displayName),
      avatarColor: command.avatarColor,
      createdAt: createTimestamp(),
    }

    record.actors.push(actor)

    return toSnapshot(record, actor.id)
  }

  async getSpace(command: GetSpaceCommand): Promise<WikiSpaceSnapshot> {
    return toSnapshot(getExistingRecord(command.wikiSpaceId), command.actorId)
  }
}

export const getWikiSpaceStore = (_env: WorkerEnv): WikiSpaceStore =>
  new LocalDemoWikiSpaceStore()

export const resetLocalDemoWikiSpaceStoreForTests = (): void => {
  localDemoSpaces.clear()
}
