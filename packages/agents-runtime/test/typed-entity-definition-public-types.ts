import { z } from 'zod'
import { db, defineEntity, type SharedStateHandle } from '../src/index'

const noteSchema = z.object({
  key: z.string(),
  count: z.number().default(0),
})

const sharedSchema = {
  notes: {
    schema: noteSchema,
    type: `shared:note`,
    primaryKey: `key`,
  },
} as const

type SharedNotes = SharedStateHandle<typeof sharedSchema>

declare const shared: SharedNotes

shared.notes.insert({ key: `note-1` })
shared.notes.update(`note-1`, (draft) => {
  draft.count += 1
})
shared.notes.get(`note-1`)?.count.toFixed()

// @ts-expect-error count must be a number when provided
shared.notes.insert({ key: `note-1`, count: `wrong` })

defineEntity(`typed-agent`, {
  creationSchema: z.object({
    topic: z.string(),
    depth: z.number(),
  }),
  state: {
    notes: {
      schema: noteSchema,
      type: `state:note`,
      primaryKey: `key`,
    },
  },
  actions: (collections) => ({
    touch(key: string) {
      collections.notes.get(key)?.count.toFixed()
    },
  }),
  async handler(ctx) {
    ctx.args.topic.toUpperCase()
    ctx.args.depth.toFixed()

    // @ts-expect-error args are inferred from creationSchema
    ctx.args.missing

    ctx.state.notes.insert({ key: `note-1` })
    ctx.state.notes.update(`note-1`, (draft) => {
      draft.count += 1
    })
    ctx.state.notes.get(`note-1`)?.count.toFixed()

    ctx.db.actions.notes_insert({ row: { key: `note-1` } })
    ctx.db.actions.notes_update({
      key: `note-1`,
      updater: (draft) => {
        draft.count += 1
      },
    })
    ctx.db.actions.notes_delete({ key: `note-1` })

    // @ts-expect-error generated insert action uses the collection schema input
    ctx.db.actions.notes_insert({ row: { key: `note-1`, count: `wrong` } })

    ctx.actions.touch(`note-1`)
    // @ts-expect-error custom action parameters are preserved
    ctx.actions.touch(123)

    const observed = await ctx.observe(db(`shared-notes`, sharedSchema))
    observed.notes.insert({ key: `note-2` })
    observed.notes.get(`note-2`)?.count.toFixed()
  },
})

defineEntity(`stateless-agent`, {
  handler(ctx) {
    // @ts-expect-error no declared state means no generated state proxy
    ctx.state.notes

    // @ts-expect-error no declared state means no generated db action
    ctx.db.actions.notes_insert
  },
})
