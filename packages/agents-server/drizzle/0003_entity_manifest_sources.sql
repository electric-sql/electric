CREATE TABLE entity_manifest_sources (
  owner_entity_url text NOT NULL,
  manifest_key text NOT NULL,
  source_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_entity_manifest_source UNIQUE (owner_entity_url, manifest_key)
);

CREATE INDEX idx_entity_manifest_sources_source_ref
  ON entity_manifest_sources (source_ref);
