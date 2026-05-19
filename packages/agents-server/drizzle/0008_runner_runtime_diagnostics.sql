CREATE TABLE runner_runtime_diagnostics (
  tenant_id text NOT NULL DEFAULT 'default',
  runner_id text NOT NULL,
  owner_principal text NOT NULL,
  wake_stream_offset text,
  last_seen_at timestamp with time zone NOT NULL,
  liveness_lease_expires_at timestamp with time zone NOT NULL,
  diagnostics jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, runner_id)
);
--> statement-breakpoint
CREATE INDEX idx_runner_runtime_diagnostics_owner
  ON runner_runtime_diagnostics (tenant_id, owner_principal);
--> statement-breakpoint
CREATE INDEX idx_runner_runtime_diagnostics_liveness
  ON runner_runtime_diagnostics (tenant_id, liveness_lease_expires_at);
--> statement-breakpoint
INSERT INTO runner_runtime_diagnostics (
  tenant_id,
  runner_id,
  owner_principal,
  wake_stream_offset,
  last_seen_at,
  liveness_lease_expires_at,
  diagnostics,
  updated_at
)
SELECT
  tenant_id,
  id,
  owner_principal,
  wake_stream_offset,
  COALESCE(last_seen_at, updated_at),
  COALESCE(liveness_lease_expires_at, updated_at),
  diagnostics,
  updated_at
FROM runners
WHERE last_seen_at IS NOT NULL
   OR liveness_lease_expires_at IS NOT NULL
   OR wake_stream_offset IS NOT NULL
   OR diagnostics IS NOT NULL;
--> statement-breakpoint
ALTER TABLE runners DROP COLUMN diagnostics;
--> statement-breakpoint
ALTER TABLE runners DROP COLUMN wake_stream_offset;
--> statement-breakpoint
ALTER TABLE runners DROP COLUMN last_seen_at;
--> statement-breakpoint
ALTER TABLE runners DROP COLUMN liveness_lease_expires_at;
