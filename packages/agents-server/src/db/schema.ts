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
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

export const entityTypes = pgTable(
  `entity_types`,
  {
    tenantId: text(`tenant_id`).notNull().default(`default`),
    name: text(`name`).notNull(),
    description: text(`description`).notNull(),
    creationSchema: jsonb(`creation_schema`),
    inboxSchemas: jsonb(`inbox_schemas`),
    stateSchemas: jsonb(`state_schemas`),
    serveEndpoint: text(`serve_endpoint`),
    defaultDispatchPolicy: jsonb(`default_dispatch_policy`),
    revision: integer(`revision`).notNull().default(1),
    createdAt: text(`created_at`).notNull(),
    updatedAt: text(`updated_at`).notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.name] })]
)

export const entities = pgTable(
  `entities`,
  {
    tenantId: text(`tenant_id`).notNull().default(`default`),
    url: text(`url`).notNull(),
    type: text(`type`).notNull(),
    status: text(`status`).notNull().default(`idle`),
    subscriptionId: text(`subscription_id`).notNull(),
    dispatchPolicy: jsonb(`dispatch_policy`),
    writeToken: text(`write_token`).notNull(),
    tags: jsonb(`tags`).notNull().default({}),
    tagsIndex: text(`tags_index`)
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    spawnArgs: jsonb(`spawn_args`).default({}),
    parent: text(`parent`),
    createdBy: text(`created_by`),
    typeRevision: integer(`type_revision`),
    inboxSchemas: jsonb(`inbox_schemas`),
    stateSchemas: jsonb(`state_schemas`),
    createdAt: bigint(`created_at`, { mode: `number` }).notNull(),
    updatedAt: bigint(`updated_at`, { mode: `number` }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.url] }),
    index(`idx_entities_type`).on(table.tenantId, table.type),
    index(`idx_entities_status`).on(table.tenantId, table.status),
    index(`idx_entities_parent`).on(table.tenantId, table.parent),
    index(`idx_entities_created_by`).on(table.tenantId, table.createdBy),
    index(`entities_tags_index_gin`).using(`gin`, table.tagsIndex),
    check(
      `chk_entities_status`,
      sql`${table.status} IN ('spawning', 'running', 'idle', 'stopped')`
    ),
  ]
)

export const users = pgTable(
  `users`,
  {
    tenantId: text(`tenant_id`).notNull().default(`default`),
    id: text(`id`).notNull(),
    displayName: text(`display_name`),
    email: text(`email`),
    avatarUrl: text(`avatar_url`),
    authProvider: text(`auth_provider`),
    authSubject: text(`auth_subject`),
    profile: jsonb(`profile`).notNull().default({}),
    metadata: jsonb(`metadata`).notNull().default({}),
    createdAt: timestamp(`created_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp(`updated_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    index(`idx_users_email`).on(table.tenantId, table.email),
    index(`idx_users_auth_identity`).on(
      table.tenantId,
      table.authProvider,
      table.authSubject
    ),
  ]
)

export const runners = pgTable(
  `runners`,
  {
    tenantId: text(`tenant_id`).notNull().default(`default`),
    id: text(`id`).notNull(),
    ownerUserId: text(`owner_user_id`).notNull(),
    label: text(`label`).notNull(),
    kind: text(`kind`).notNull().default(`local`),
    adminStatus: text(`admin_status`).notNull().default(`enabled`),
    wakeStream: text(`wake_stream`).notNull(),
    wakeStreamOffset: text(`wake_stream_offset`),
    lastSeenAt: timestamp(`last_seen_at`, { withTimezone: true }),
    livenessLeaseExpiresAt: timestamp(`liveness_lease_expires_at`, {
      withTimezone: true,
    }),
    createdAt: timestamp(`created_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp(`updated_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    unique(`uq_runners_wake_stream`).on(table.tenantId, table.wakeStream),
    index(`idx_runners_owner_user_id`).on(table.tenantId, table.ownerUserId),
    index(`idx_runners_admin_status`).on(table.tenantId, table.adminStatus),
    index(`idx_runners_liveness_lease_expires_at`).on(
      table.tenantId,
      table.livenessLeaseExpiresAt
    ),
    check(
      `chk_runners_kind`,
      sql`${table.kind} IN ('local', 'cloud-worker', 'sandbox', 'ci', 'server')`
    ),
    check(
      `chk_runners_admin_status`,
      sql`${table.adminStatus} IN ('enabled', 'disabled')`
    ),
  ]
)

export const entityDispatchState = pgTable(
  `entity_dispatch_state`,
  {
    tenantId: text(`tenant_id`).notNull().default(`default`),
    entityUrl: text(`entity_url`).notNull(),
    pendingSourceStreams: jsonb(`pending_source_streams`).notNull().default([]),
    pendingReason: text(`pending_reason`),
    pendingSince: timestamp(`pending_since`, { withTimezone: true }),
    outstandingWakeId: text(`outstanding_wake_id`),
    outstandingWakeTarget: jsonb(`outstanding_wake_target`),
    outstandingWakeCreatedAt: timestamp(`outstanding_wake_created_at`, {
      withTimezone: true,
    }),
    activeConsumerId: text(`active_consumer_id`),
    activeRunnerId: text(`active_runner_id`),
    activeEpoch: integer(`active_epoch`),
    activeClaimedAt: timestamp(`active_claimed_at`, { withTimezone: true }),
    activeLeaseExpiresAt: timestamp(`active_lease_expires_at`, {
      withTimezone: true,
    }),
    lastWakeId: text(`last_wake_id`),
    lastClaimedAt: timestamp(`last_claimed_at`, { withTimezone: true }),
    lastReleasedAt: timestamp(`last_released_at`, { withTimezone: true }),
    lastCompletedAt: timestamp(`last_completed_at`, { withTimezone: true }),
    lastError: text(`last_error`),
    updatedAt: timestamp(`updated_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.entityUrl] }),
    index(`idx_entity_dispatch_state_active_runner`).on(
      table.tenantId,
      table.activeRunnerId
    ),
    index(`idx_entity_dispatch_state_outstanding_wake`).on(
      table.tenantId,
      table.outstandingWakeId
    ),
    index(`idx_entity_dispatch_state_active_lease`).on(
      table.tenantId,
      table.activeLeaseExpiresAt
    ),
  ]
)

export const wakeNotifications = pgTable(
  `wake_notifications`,
  {
    tenantId: text(`tenant_id`).notNull().default(`default`),
    wakeId: text(`wake_id`).notNull(),
    entityUrl: text(`entity_url`).notNull(),
    targetType: text(`target_type`).notNull(),
    targetRunnerId: text(`target_runner_id`),
    targetWebhookUrl: text(`target_webhook_url`),
    targetWorkerPoolId: text(`target_worker_pool_id`),
    runnerWakeStream: text(`runner_wake_stream`),
    runnerWakeStreamOffset: text(`runner_wake_stream_offset`),
    notificationPublic: jsonb(`notification_public`).notNull(),
    deliveryStatus: text(`delivery_status`).notNull().default(`queued`),
    claimStatus: text(`claim_status`).notNull().default(`unclaimed`),
    createdAt: timestamp(`created_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp(`delivered_at`, { withTimezone: true }),
    claimedAt: timestamp(`claimed_at`, { withTimezone: true }),
    resolvedAt: timestamp(`resolved_at`, { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.wakeId] }),
    index(`idx_wake_notifications_entity_url`).on(
      table.tenantId,
      table.entityUrl
    ),
    index(`idx_wake_notifications_target_runner`).on(
      table.tenantId,
      table.targetRunnerId
    ),
    index(`idx_wake_notifications_delivery_status`).on(
      table.tenantId,
      table.deliveryStatus
    ),
    index(`idx_wake_notifications_claim_status`).on(
      table.tenantId,
      table.claimStatus
    ),
    index(`idx_wake_notifications_created_at`).on(
      table.tenantId,
      table.createdAt
    ),
    check(
      `chk_wake_notifications_target_type`,
      sql`${table.targetType} IN ('webhook', 'runner', 'worker-pool')`
    ),
    check(
      `chk_wake_notifications_delivery_status`,
      sql`${table.deliveryStatus} IN ('queued', 'delivered', 'failed', 'superseded')`
    ),
    check(
      `chk_wake_notifications_claim_status`,
      sql`${table.claimStatus} IN ('unclaimed', 'claimed', 'completed', 'expired')`
    ),
  ]
)

export const consumerClaims = pgTable(
  `consumer_claims`,
  {
    tenantId: text(`tenant_id`).notNull().default(`default`),
    consumerId: text(`consumer_id`).notNull(),
    epoch: integer(`epoch`).notNull(),
    wakeId: text(`wake_id`),
    entityUrl: text(`entity_url`).notNull(),
    streamPath: text(`stream_path`).notNull(),
    runnerId: text(`runner_id`),
    status: text(`status`).notNull().default(`active`),
    claimedAt: timestamp(`claimed_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastHeartbeatAt: timestamp(`last_heartbeat_at`, { withTimezone: true }),
    leaseExpiresAt: timestamp(`lease_expires_at`, { withTimezone: true }),
    releasedAt: timestamp(`released_at`, { withTimezone: true }),
    ackedStreams: jsonb(`acked_streams`),
    updatedAt: timestamp(`updated_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.consumerId, table.epoch] }),
    index(`idx_consumer_claims_entity_status`).on(
      table.tenantId,
      table.entityUrl,
      table.status
    ),
    index(`idx_consumer_claims_runner`).on(table.tenantId, table.runnerId),
    index(`idx_consumer_claims_wake_id`).on(table.tenantId, table.wakeId),
    index(`idx_consumer_claims_lease_expires_at`).on(
      table.tenantId,
      table.leaseExpiresAt
    ),
    check(
      `chk_consumer_claims_status`,
      sql`${table.status} IN ('active', 'released', 'expired', 'failed')`
    ),
  ]
)

export const wakeRegistrations = pgTable(
  `wake_registrations`,
  {
    id: serial(`id`).primaryKey(),
    tenantId: text(`tenant_id`).notNull().default(`default`),
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
    index(`idx_wake_source_url`).on(table.tenantId, table.sourceUrl),
    unique(`uq_wake_registration`).on(
      table.tenantId,
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

export const subscriptionWebhooks = pgTable(
  `subscription_webhooks`,
  {
    tenantId: text(`tenant_id`).notNull().default(`default`),
    subscriptionId: text(`subscription_id`).notNull(),
    webhookUrl: text(`webhook_url`).notNull(),
    createdAt: timestamp(`created_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.subscriptionId] })]
)

export const consumerCallbacks = pgTable(
  `consumer_callbacks`,
  {
    tenantId: text(`tenant_id`).notNull().default(`default`),
    consumerId: text(`consumer_id`).notNull(),
    callbackUrl: text(`callback_url`).notNull(),
    primaryStream: text(`primary_stream`),
    createdAt: timestamp(`created_at`, { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.consumerId] }),
    index(`idx_consumer_callbacks_primary_stream`).on(
      table.tenantId,
      table.primaryStream
    ),
  ]
)

export const scheduledTasks = pgTable(
  `scheduled_tasks`,
  {
    id: bigserial(`id`, { mode: `number` }).primaryKey(),
    tenantId: text(`tenant_id`).notNull().default(`default`),
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
      .on(table.tenantId, table.fireAt)
      .where(sql`${table.completedAt} IS NULL AND ${table.claimedAt} IS NULL`),
    unique(`uq_cron_tick`).on(
      table.tenantId,
      table.cronExpression,
      table.cronTimezone,
      table.cronTickNumber
    ),
    index(`idx_scheduled_tasks_manifest_pending`)
      .on(table.tenantId, table.ownerEntityUrl, table.manifestKey)
      .where(
        sql`${table.kind} = 'delayed_send' AND ${table.completedAt} IS NULL AND ${table.manifestKey} IS NOT NULL`
      ),
    index(`idx_scheduled_tasks_stale_claims`)
      .on(table.tenantId, table.claimedAt)
      .where(
        sql`${table.completedAt} IS NULL AND ${table.claimedAt} IS NOT NULL`
      ),
  ]
)

export const entityBridges = pgTable(
  `entity_bridges`,
  {
    tenantId: text(`tenant_id`).notNull().default(`default`),
    sourceRef: text(`source_ref`).notNull(),
    tags: jsonb(`tags`).notNull(),
    streamUrl: text(`stream_url`).notNull(),
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
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.sourceRef] }),
    unique(`uq_entity_bridges_stream_url`).on(table.tenantId, table.streamUrl),
  ]
)

export const entityManifestSources = pgTable(
  `entity_manifest_sources`,
  {
    tenantId: text(`tenant_id`).notNull().default(`default`),
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
      table.tenantId,
      table.ownerEntityUrl,
      table.manifestKey
    ),
    index(`idx_entity_manifest_sources_source_ref`).on(
      table.tenantId,
      table.sourceRef
    ),
  ]
)

export const tagStreamOutbox = pgTable(
  `tag_stream_outbox`,
  {
    id: bigserial(`id`, { mode: `number` }).primaryKey(),
    tenantId: text(`tenant_id`).notNull().default(`default`),
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
      .on(table.tenantId, table.createdAt)
      .where(
        sql`${table.claimedAt} IS NULL AND ${table.deadLetteredAt} IS NULL`
      ),
    index(`idx_tag_stream_outbox_stale_claims`)
      .on(table.tenantId, table.claimedAt)
      .where(
        sql`${table.claimedAt} IS NOT NULL AND ${table.deadLetteredAt} IS NULL`
      ),
  ]
)
