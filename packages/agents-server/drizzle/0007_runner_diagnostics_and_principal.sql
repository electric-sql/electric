UPDATE consumer_claims
SET status = 'expired', updated_at = NOW()
WHERE status = 'active' AND runner_id IS NOT NULL;
--> statement-breakpoint
UPDATE entity_dispatch_state
SET active_runner_id = NULL,
    active_consumer_id = NULL,
    active_epoch = NULL,
    active_claimed_at = NULL,
    active_lease_expires_at = NULL,
    updated_at = NOW()
WHERE active_runner_id IS NOT NULL;
--> statement-breakpoint
DELETE FROM runners;
--> statement-breakpoint
ALTER TABLE runners RENAME COLUMN owner_user_id TO owner_principal;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_runners_owner_user_id;
--> statement-breakpoint
CREATE INDEX idx_runners_owner_principal ON runners (tenant_id, owner_principal);
--> statement-breakpoint
ALTER TABLE runners ADD COLUMN diagnostics jsonb;
