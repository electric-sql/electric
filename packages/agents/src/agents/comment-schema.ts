import { z } from 'zod'

export const commentCollectionSchema = z.looseObject({
  body: z.string().min(1),
  from_principal: z.string(),
  timestamp: z.string(),
  reply_to: z
    .union([
      z.strictObject({
        kind: z.literal(`comment`),
        key: z.string(),
      }),
      z.strictObject({
        kind: z.literal(`timeline`),
        collection: z.enum([
          `inbox`,
          `run`,
          `text`,
          `tool_call`,
          `wake`,
          `signal`,
          `manifest`,
        ]),
        key: z.string(),
        run_id: z.string().optional(),
      }),
    ])
    .optional(),
  target_snapshot: z
    .looseObject({
      label: z.string(),
      text: z.string().optional(),
      from: z.string().optional(),
      timestamp: z.string().optional(),
      collection: z.string().optional(),
    })
    .optional(),
  edited_at: z.string().optional(),
  deleted_at: z.string().optional(),
  deleted_by: z.string().optional(),
})
