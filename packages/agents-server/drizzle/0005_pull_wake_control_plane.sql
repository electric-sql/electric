ALTER TABLE entity_types
  ADD COLUMN default_dispatch_policy jsonb;
--> statement-breakpoint
ALTER TABLE entities
  ADD COLUMN dispatch_policy jsonb;
--> statement-breakpoint
CREATE TABLE users (
  tenant_id text NOT NULL DEFAULT 'default',
  id text NOT NULL,
  display_name text,
  email text,
  avatar_url text,
  auth_provider text,
  auth_subject text,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
--> statement-breakpoint
CREATE INDEX idx_users_email ON users (tenant_id, email);
--> statement-breakpoint
CREATE INDEX idx_users_auth_identity
  ON users (tenant_id, auth_provider, auth_subject);
--> statement-breakpoint
CREATE TABLE runners (
  tenant_id text NOT NULL DEFAULT 'default',
  id text NOT NULL,
  owner_user_id text NOT NULL,
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'local',
  admin_status text NOT NULL DEFAULT 'enabled',
  wake_stream text NOT NULL,
  wake_stream_offset text,
  last_seen_at timestamptz,
  liveness_lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT uq_runners_wake_stream UNIQUE (tenant_id, wake_stream),
  CONSTRAINT chk_runners_kind CHECK (kind IN ('local', 'cloud-worker', 'sandbox', 'ci', 'server')),
  CONSTRAINT chk_runners_admin_status CHECK (admin_status IN ('enabled', 'disabled'))
);
--> statement-breakpoint
CREATE INDEX idx_runners_owner_user_id ON runners (tenant_id, owner_user_id);
--> statement-breakpoint
CREATE INDEX idx_runners_admin_status ON runners (tenant_id, admin_status);
--> statement-breakpoint
CREATE INDEX idx_runners_liveness_lease_expires_at
  ON runners (tenant_id, liveness_lease_expires_at);
--> statement-breakpoint
CREATE TABLE entity_dispatch_state (
  tenant_id text NOT NULL DEFAULT 'default',
  entity_url text NOT NULL,
  pending_source_streams jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending_reason text,
  pending_since timestamptz,
  outstanding_wake_id text,
  outstanding_wake_target jsonb,
  outstanding_wake_created_at timestamptz,
  active_consumer_id text,
  active_runner_id text,
  active_epoch integer,
  active_claimed_at timestamptz,
  active_lease_expires_at timestamptz,
  last_wake_id text,
  last_claimed_at timestamptz,
  last_released_at timestamptz,
  last_completed_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_url)
);
--> statement-breakpoint
CREATE INDEX idx_entity_dispatch_state_active_runner
  ON entity_dispatch_state (tenant_id, active_runner_id);
--> statement-breakpoint
CREATE INDEX idx_entity_dispatch_state_outstanding_wake
  ON entity_dispatch_state (tenant_id, outstanding_wake_id);
--> statement-breakpoint
CREATE INDEX idx_entity_dispatch_state_active_lease
  ON entity_dispatch_state (tenant_id, active_lease_expires_at);
--> statement-breakpoint
INSERT INTO entity_dispatch_state (tenant_id, entity_url)
SELECT tenant_id, url FROM entities
ON CONFLICT (tenant_id, entity_url) DO NOTHING;
--> statement-breakpoint
CREATE TABLE wake_notifications (
  tenant_id text NOT NULL DEFAULT 'default',
  wake_id text NOT NULL,
  entity_url text NOT NULL,
  target_type text NOT NULL,
  target_runner_id text,
  target_webhook_url text,
  target_worker_pool_id text,
  runner_wake_stream text,
  runner_wake_stream_offset text,
  notification_public jsonb NOT NULL,
  delivery_status text NOT NULL DEFAULT 'queued',
  claim_status text NOT NULL DEFAULT 'unclaimed',
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  claimed_at timestamptz,
  resolved_at timestamptz,
  PRIMARY KEY (tenant_id, wake_id),
  CONSTRAINT chk_wake_notifications_target_type CHECK (target_type IN ('webhook', 'runner', 'worker-pool')),
  CONSTRAINT chk_wake_notifications_delivery_status CHECK (delivery_status IN ('queued', 'delivered', 'failed', 'superseded')),
  CONSTRAINT chk_wake_notifications_claim_status CHECK (claim_status IN ('unclaimed', 'claimed', 'completed', 'expired'))
);
--> statement-breakpoint
CREATE INDEX idx_wake_notifications_entity_url
  ON wake_notifications (tenant_id, entity_url);
--> statement-breakpoint
CREATE INDEX idx_wake_notifications_target_runner
  ON wake_notifications (tenant_id, target_runner_id);
--> statement-breakpoint
CREATE INDEX idx_wake_notifications_delivery_status
  ON wake_notifications (tenant_id, delivery_status);
--> statement-breakpoint
CREATE INDEX idx_wake_notifications_claim_status
  ON wake_notifications (tenant_id, claim_status);
--> statement-breakpoint
CREATE INDEX idx_wake_notifications_created_at
  ON wake_notifications (tenant_id, created_at);
--> statement-breakpoint
CREATE TABLE consumer_claims (
  tenant_id text NOT NULL DEFAULT 'default',
  consumer_id text NOT NULL,
  epoch integer NOT NULL,
  wake_id text,
  entity_url text NOT NULL,
  stream_path text NOT NULL,
  runner_id text,
  status text NOT NULL DEFAULT 'active',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  released_at timestamptz,
  acked_streams jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, consumer_id, epoch),
  CONSTRAINT chk_consumer_claims_status CHECK (status IN ('active', 'released', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE INDEX idx_consumer_claims_entity_status
  ON consumer_claims (tenant_id, entity_url, status);
--> statement-breakpoint
CREATE INDEX idx_consumer_claims_runner
  ON consumer_claims (tenant_id, runner_id);
--> statement-breakpoint
CREATE INDEX idx_consumer_claims_wake_id
  ON consumer_claims (tenant_id, wake_id);
--> statement-breakpoint
CREATE INDEX idx_consumer_claims_lease_expires_at
  ON consumer_claims (tenant_id, lease_expires_at);
