ALTER TABLE entity_types
  ADD COLUMN tenant_id text NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE entities
  ADD COLUMN tenant_id text NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE wake_registrations
  ADD COLUMN tenant_id text NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE subscription_webhooks
  ADD COLUMN tenant_id text NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE consumer_callbacks
  ADD COLUMN tenant_id text NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE scheduled_tasks
  ADD COLUMN tenant_id text NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE entity_bridges
  ADD COLUMN tenant_id text NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE entity_manifest_sources
  ADD COLUMN tenant_id text NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE tag_stream_outbox
  ADD COLUMN tenant_id text NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE entity_types
  DROP CONSTRAINT entity_types_pkey,
  ADD CONSTRAINT entity_types_pkey PRIMARY KEY (tenant_id, name);
--> statement-breakpoint
ALTER TABLE entities
  DROP CONSTRAINT entities_pkey,
  ADD CONSTRAINT entities_pkey PRIMARY KEY (tenant_id, url);
--> statement-breakpoint
ALTER TABLE subscription_webhooks
  DROP CONSTRAINT subscription_webhooks_pkey,
  ADD CONSTRAINT subscription_webhooks_pkey PRIMARY KEY (tenant_id, subscription_id);
--> statement-breakpoint
ALTER TABLE consumer_callbacks
  DROP CONSTRAINT consumer_callbacks_pkey,
  ADD CONSTRAINT consumer_callbacks_pkey PRIMARY KEY (tenant_id, consumer_id);
--> statement-breakpoint
ALTER TABLE entity_bridges
  DROP CONSTRAINT entity_bridges_pkey,
  DROP CONSTRAINT IF EXISTS entity_bridges_stream_url_unique,
  DROP CONSTRAINT IF EXISTS entity_bridges_stream_url_key,
  ADD CONSTRAINT entity_bridges_pkey PRIMARY KEY (tenant_id, source_ref),
  ADD CONSTRAINT uq_entity_bridges_stream_url UNIQUE (tenant_id, stream_url);
--> statement-breakpoint
ALTER TABLE wake_registrations
  DROP CONSTRAINT uq_wake_registration,
  ADD CONSTRAINT uq_wake_registration UNIQUE (
    tenant_id,
    subscriber_url,
    source_url,
    one_shot,
    debounce_ms,
    timeout_ms,
    condition,
    manifest_key
  );
--> statement-breakpoint
ALTER TABLE scheduled_tasks
  DROP CONSTRAINT uq_cron_tick,
  ADD CONSTRAINT uq_cron_tick UNIQUE (
    tenant_id,
    cron_expression,
    cron_timezone,
    cron_tick_number
  );
--> statement-breakpoint
ALTER TABLE entity_manifest_sources
  DROP CONSTRAINT uq_entity_manifest_source,
  ADD CONSTRAINT uq_entity_manifest_source UNIQUE (
    tenant_id,
    owner_entity_url,
    manifest_key
  );
--> statement-breakpoint
DROP INDEX IF EXISTS idx_entities_type;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_entities_status;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_entities_parent;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_wake_source_url;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_scheduled_tasks_fire_ready;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_scheduled_tasks_manifest_pending;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_scheduled_tasks_stale_claims;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_entity_manifest_sources_source_ref;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_tag_stream_outbox_unclaimed;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_tag_stream_outbox_stale_claims;
--> statement-breakpoint
CREATE INDEX idx_entities_type
  ON entities (tenant_id, type);
--> statement-breakpoint
CREATE INDEX idx_entities_status
  ON entities (tenant_id, status);
--> statement-breakpoint
CREATE INDEX idx_entities_parent
  ON entities (tenant_id, parent);
--> statement-breakpoint
CREATE INDEX idx_wake_source_url
  ON wake_registrations (tenant_id, source_url);
--> statement-breakpoint
CREATE INDEX idx_consumer_callbacks_primary_stream
  ON consumer_callbacks (tenant_id, primary_stream);
--> statement-breakpoint
CREATE INDEX idx_scheduled_tasks_fire_ready
  ON scheduled_tasks (tenant_id, fire_at)
  WHERE completed_at IS NULL AND claimed_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_scheduled_tasks_manifest_pending
  ON scheduled_tasks (tenant_id, owner_entity_url, manifest_key)
  WHERE kind = 'delayed_send'
    AND completed_at IS NULL
    AND manifest_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_scheduled_tasks_stale_claims
  ON scheduled_tasks (tenant_id, claimed_at)
  WHERE completed_at IS NULL AND claimed_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_entity_manifest_sources_source_ref
  ON entity_manifest_sources (tenant_id, source_ref);
--> statement-breakpoint
CREATE INDEX idx_tag_stream_outbox_unclaimed
  ON tag_stream_outbox (tenant_id, created_at)
  WHERE claimed_at IS NULL AND dead_lettered_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_tag_stream_outbox_stale_claims
  ON tag_stream_outbox (tenant_id, claimed_at)
  WHERE claimed_at IS NOT NULL AND dead_lettered_at IS NULL;
