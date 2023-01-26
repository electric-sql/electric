CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content VARCHAR(64) NOT NULL,
  content_b VARCHAR(64)
);
ALTER TABLE entries REPLICA IDENTITY FULL;

CREATE TABLE owned_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  electric_user_id VARCHAR(255) NOT NULL,
  content VARCHAR(64) NOT NULL
);
ALTER TABLE owned_entries REPLICA IDENTITY FULL;

CREATE TABLE entries_default (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content VARCHAR(64) NOT NULL,
  content_b VARCHAR(64)
);
ALTER TABLE entries_default REPLICA IDENTITY DEFAULT;

CREATE SCHEMA electric;
CREATE TABLE electric.migrations (
  id SERIAL PRIMARY KEY,
  version VARCHAR(64) NOT NULL,
  hash VARCHAR(64) NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(version)
);

INSERT INTO electric.migrations (version, hash) VALUES ('1', 'initial');
