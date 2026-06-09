import { jsonSchema } from '@electric-ax/agents-runtime'

/**
 * `comment` custom collection schema accepted by horton and worker
 * entities. Declared in this package (not in agents-runtime) so the
 * runtime stays transparent — comments are an opt-in feature of these
 * specific built-in agents, validated server-side via the per-entity-type
 * `custom_collection_schemas` registration.
 */
export const commentCollectionSchema = jsonSchema({
  $schema: `http://json-schema.org/draft-07/schema#`,
  type: `object`,
  properties: {
    body: {
      type: `string`,
      minLength: 1,
    },
    from_principal: {
      type: `string`,
    },
    timestamp: {
      type: `string`,
    },
    reply_to: {
      oneOf: [
        {
          type: `object`,
          properties: {
            kind: { type: `string`, enum: [`comment`] },
            key: { type: `string` },
          },
          required: [`kind`, `key`],
          additionalProperties: false,
        },
        {
          type: `object`,
          properties: {
            kind: { type: `string`, enum: [`timeline`] },
            collection: {
              type: `string`,
              enum: [
                `inbox`,
                `run`,
                `text`,
                `tool_call`,
                `wake`,
                `signal`,
                `manifest`,
              ],
            },
            key: { type: `string` },
            run_id: { type: `string` },
          },
          required: [`kind`, `collection`, `key`],
          additionalProperties: false,
        },
      ],
    },
    target_snapshot: {
      type: `object`,
      properties: {
        label: { type: `string` },
        text: { type: `string` },
        from: { type: `string` },
        timestamp: { type: `string` },
        collection: { type: `string` },
      },
      required: [`label`],
      additionalProperties: true,
    },
    edited_at: { type: `string` },
    deleted_at: { type: `string` },
    deleted_by: { type: `string` },
  },
  required: [`body`, `from_principal`, `timestamp`],
  additionalProperties: true,
})
