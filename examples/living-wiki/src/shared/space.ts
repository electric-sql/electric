import { z } from 'zod'

export const demoAvatarColors = [
  `slate`,
  `blue`,
  `green`,
  `orange`,
  `purple`,
  `pink`,
] as const

export type DemoAvatarColor = (typeof demoAvatarColors)[number]

export type ActorKind = `human`

export type DemoActor = {
  id: string
  wikiSpaceId: string
  kind: ActorKind
  displayName: string
  avatarColor: DemoAvatarColor
  createdAt: string
}

export type WikiSpaceSummary = {
  id: string
  title: string
  createdAt: string
  createdByActorId: string
  memberCount: number
}

export type WikiSpaceSnapshot = {
  space: WikiSpaceSummary
  currentActor: DemoActor
  actors: DemoActor[]
}

export type CreateSpaceInput = {
  title: string
  displayName: string
  avatarColor: DemoAvatarColor
}

export type JoinSpaceInput = {
  wikiSpaceId: string
  displayName: string
  avatarColor: DemoAvatarColor
  actorId?: string
}

export type GetSpaceInput = {
  wikiSpaceId: string
  actorId?: string
}

const trimmedString = (min: number, max: number) =>
  z.string().trim().min(min).max(max)

const wikiSpaceIdSchema = z.string().regex(/^wiki_[a-z0-9_-]+$/)
const actorIdSchema = z.string().regex(/^actor_[a-z0-9_-]+$/)
const isoDateStringSchema = z.string().datetime({ offset: true })

export const demoAvatarColorSchema = z.enum(demoAvatarColors)

export const createSpaceInputSchema = z.object({
  title: trimmedString(1, 120),
  displayName: trimmedString(1, 80),
  avatarColor: demoAvatarColorSchema,
})

export const joinSpaceInputSchema = z.object({
  wikiSpaceId: wikiSpaceIdSchema,
  displayName: trimmedString(1, 80),
  avatarColor: demoAvatarColorSchema,
  actorId: actorIdSchema.optional(),
})

export const getSpaceInputSchema = z.object({
  wikiSpaceId: wikiSpaceIdSchema,
  actorId: actorIdSchema.optional(),
})

export const demoActorSchema = z.object({
  id: actorIdSchema,
  wikiSpaceId: wikiSpaceIdSchema,
  kind: z.literal(`human`),
  displayName: trimmedString(1, 80),
  avatarColor: demoAvatarColorSchema,
  createdAt: isoDateStringSchema,
})

export const wikiSpaceSummarySchema = z.object({
  id: wikiSpaceIdSchema,
  title: trimmedString(1, 120),
  createdAt: isoDateStringSchema,
  createdByActorId: actorIdSchema,
  memberCount: z.number().int().nonnegative(),
})

export const wikiSpaceSnapshotSchema = z.object({
  space: wikiSpaceSummarySchema,
  currentActor: demoActorSchema,
  actors: z.array(demoActorSchema),
})
