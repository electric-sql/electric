import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

export const entityTypes = pgTable(`entity_types`, {
  name: text(`name`).primaryKey(),
  description: text(`description`).notNull(),
  creationSchema: jsonb(`creation_schema`),
  inboxSchemas: jsonb(`inbox_schemas`),
  stateSchemas: jsonb(`state_schemas`),
  serveEndpoint: text(`serve_endpoint`),
  revision: integer(`revision`).notNull().default(1),
  createdAt: text(`created_at`).notNull(),
  updatedAt: text(`updated_at`).notNull(),
})

export const entities = pgTable(
  `entities`,
  {
    url: text(`url`).primaryKey(),
    type: text(`type`).notNull(),
    status: text(`status`).notNull().default(`idle`),
    subscriptionId: text(`subscription_id`).notNull(),
    writeToken: text(`write_token`).notNull(),
    tags: jsonb(`tags`).notNull().default({}),
    tagsIndex: text(`tags_index`)
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    spawnArgs: jsonb(`spawn_args`).default({}),
    parent: text(`parent`),
    typeRevision: integer(`type_revision`),
    inboxSchemas: jsonb(`inbox_schemas`),
    stateSchemas: jsonb(`state_schemas`),
    createdAt: bigint(`created_at`, { mode: `number` }).notNull(),
    updatedAt: bigint(`updated_at`, { mode: `number` }).notNull(),
  },
  (table) => [
    index(`idx_entities_type`).on(table.type),
    index(`idx_entities_status`).on(table.status),
    index(`idx_entities_parent`).on(table.parent),
    index(`entities_tags_index_gin`).using(`gin`, table.tagsIndex),
    check(
      `chk_entities_status`,
      sql`${table.status} IN ('spawning', 'running', 'idle', 'stopped')`
    ),
  ]
)

export const wakeRegistrations = pgTable(
  `wake_registrations`,
  {
    id: serial(`id`).primaryKey(),
    subscriberUrl: text(`subscriber_url`).notNull(),
    sourceUrl: text(`source_url`).notNull(),
    condition: jsonb(`condition`).notNull(),
    debounceMs: integer(`debounce_ms`).notNull().default(0),
    timeoutMs: integer(`timeout_ms`).notNull().default(0),
    oneShot: boolean(`one_shot`).notNull().default(false),
    timeoutConsumed: boolean(`timeout_consumed`).notNull().default(false),
    includeResponse: boolean(`include_response`).notNull().default(true),
    manifestKey: text(`manifest_key`),
    createdAt: timestamp(`created_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index(`idx_wake_source_url`).on(table.sourceUrl),
    unique(`uq_wake_registration`).on(
      table.subscriberUrl,
      table.sourceUrl,
      table.oneShot,
      table.debounceMs,
      table.timeoutMs,
      table.condition,
      table.manifestKey
    ),
  ]
)

export const subscriptionWebhooks = pgTable(`subscription_webhooks`, {
  subscriptionId: text(`subscription_id`).primaryKey(),
  webhookUrl: text(`webhook_url`).notNull(),
  createdAt: timestamp(`created_at`, { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const consumerCallbacks = pgTable(`consumer_callbacks`, {
  consumerId: text(`consumer_id`).primaryKey(),
  callbackUrl: text(`callback_url`).notNull(),
  primaryStream: text(`primary_stream`),
  createdAt: timestamp(`created_at`, { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const scheduledTasks = pgTable(
  `scheduled_tasks`,
  {
    id: bigserial(`id`, { mode: `number` }).primaryKey(),
    kind: text(`kind`).notNull(),
    payload: jsonb(`payload`).notNull(),
    fireAt: timestamp(`fire_at`, { withTimezone: true }).notNull(),
    cronExpression: text(`cron_expression`),
    cronTimezone: text(`cron_timezone`),
    cronTickNumber: integer(`cron_tick_number`),
    ownerEntityUrl: text(`owner_entity_url`),
    manifestKey: text(`manifest_key`),
    claimedBy: text(`claimed_by`),
    claimedAt: timestamp(`claimed_at`, { withTimezone: true }),
    completedAt: timestamp(`completed_at`, { withTimezone: true }),
    lastError: text(`last_error`),
    createdAt: timestamp(`created_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      `chk_scheduled_tasks_kind`,
      sql`${table.kind} IN ('delayed_send', 'cron_tick')`
    ),
    index(`idx_scheduled_tasks_fire_ready`)
      .on(table.fireAt)
      .where(sql`${table.completedAt} IS NULL AND ${table.claimedAt} IS NULL`),
    unique(`uq_cron_tick`).on(
      table.cronExpression,
      table.cronTimezone,
      table.cronTickNumber
    ),
    index(`idx_scheduled_tasks_manifest_pending`)
      .on(table.ownerEntityUrl, table.manifestKey)
      .where(
        sql`${table.kind} = 'delayed_send' AND ${table.completedAt} IS NULL AND ${table.manifestKey} IS NOT NULL`
      ),
    index(`idx_scheduled_tasks_stale_claims`)
      .on(table.claimedAt)
      .where(
        sql`${table.completedAt} IS NULL AND ${table.claimedAt} IS NOT NULL`
      ),
  ]
)

export const entityBridges = pgTable(`entity_bridges`, {
  sourceRef: text(`source_ref`).primaryKey(),
  tags: jsonb(`tags`).notNull(),
  streamUrl: text(`stream_url`).notNull().unique(),
  shapeHandle: text(`shape_handle`),
  shapeOffset: text(`shape_offset`),
  lastObserverActivityAt: timestamp(`last_observer_activity_at`, {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
  createdAt: timestamp(`created_at`, { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp(`updated_at`, { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const entityManifestSources = pgTable(
  `entity_manifest_sources`,
  {
    ownerEntityUrl: text(`owner_entity_url`).notNull(),
    manifestKey: text(`manifest_key`).notNull(),
    sourceRef: text(`source_ref`).notNull(),
    createdAt: timestamp(`created_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp(`updated_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique(`uq_entity_manifest_source`).on(
      table.ownerEntityUrl,
      table.manifestKey
    ),
    index(`idx_entity_manifest_sources_source_ref`).on(table.sourceRef),
  ]
)

export const tagStreamOutbox = pgTable(
  `tag_stream_outbox`,
  {
    id: bigserial(`id`, { mode: `number` }).primaryKey(),
    entityUrl: text(`entity_url`).notNull(),
    collection: text(`collection`).notNull(),
    op: text(`op`).notNull(),
    key: text(`key`).notNull(),
    rowData: jsonb(`row_data`),
    attemptCount: integer(`attempt_count`).notNull().default(0),
    lastError: text(`last_error`),
    claimedBy: text(`claimed_by`),
    claimedAt: timestamp(`claimed_at`, { withTimezone: true }),
    deadLetteredAt: timestamp(`dead_lettered_at`, { withTimezone: true }),
    createdAt: timestamp(`created_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index(`idx_tag_stream_outbox_unclaimed`)
      .on(table.createdAt)
      .where(
        sql`${table.claimedAt} IS NULL AND ${table.deadLetteredAt} IS NULL`
      ),
    index(`idx_tag_stream_outbox_stale_claims`)
      .on(table.claimedAt)
      .where(
        sql`${table.claimedAt} IS NOT NULL AND ${table.deadLetteredAt} IS NULL`
      ),
  ]
)
