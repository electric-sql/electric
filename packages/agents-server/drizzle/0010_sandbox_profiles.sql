ALTER TABLE runners
  ADD COLUMN sandbox_profiles jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE entities
  ADD COLUMN sandbox jsonb;
