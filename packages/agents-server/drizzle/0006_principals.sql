ALTER TABLE entities
  ADD COLUMN created_by text;

CREATE INDEX idx_entities_created_by
  ON entities (tenant_id, created_by);
