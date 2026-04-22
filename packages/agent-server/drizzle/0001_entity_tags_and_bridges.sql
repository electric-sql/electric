-- tags_index is a text[] shadow of tags jsonb. Electric shape `where` supports
-- `@>` on text[] but not on jsonb, so membership queries for
-- observe(entities({ tags })) must scan tags_index.
ALTER TABLE entities
  DROP COLUMN metadata,
  ADD COLUMN tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN tags_index text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX entities_tags_index_gin ON entities USING gin (tags_index);

-- REPLICA IDENTITY FULL is required so Electric's logical replication emits
-- full-row payloads on UPDATE/DELETE. Without it, shape consumers can't
-- compute diffs and bridge reconcile breaks.
ALTER TABLE entities REPLICA IDENTITY FULL;

CREATE TABLE entity_bridges (
  source_ref text PRIMARY KEY,
  tags jsonb NOT NULL,
  stream_url text NOT NULL UNIQUE,
  shape_handle text,
  shape_offset text,
  last_observer_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tag_stream_outbox (
  id bigserial PRIMARY KEY,
  entity_url text NOT NULL,
  collection text NOT NULL,
  op text NOT NULL,
  key text NOT NULL,
  row_data jsonb,
  claimed_by text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tag_stream_outbox_unclaimed
  ON tag_stream_outbox (created_at)
  WHERE claimed_at IS NULL;

CREATE INDEX idx_tag_stream_outbox_stale_claims
  ON tag_stream_outbox (claimed_at)
  WHERE claimed_at IS NOT NULL;
