ALTER TABLE tag_stream_outbox
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_error text,
  ADD COLUMN dead_lettered_at timestamptz;

DROP INDEX IF EXISTS idx_tag_stream_outbox_unclaimed;
CREATE INDEX idx_tag_stream_outbox_unclaimed
  ON tag_stream_outbox (created_at)
  WHERE claimed_at IS NULL AND dead_lettered_at IS NULL;

DROP INDEX IF EXISTS idx_tag_stream_outbox_stale_claims;
CREATE INDEX idx_tag_stream_outbox_stale_claims
  ON tag_stream_outbox (claimed_at)
  WHERE claimed_at IS NOT NULL AND dead_lettered_at IS NULL;
