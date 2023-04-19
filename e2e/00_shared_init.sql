CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA electric;
CREATE TABLE electric.migrations (
  id SERIAL PRIMARY KEY,
  version VARCHAR(64) NOT NULL,
  hash VARCHAR(64) NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(version)
);

INSERT INTO electric.migrations (version, hash) VALUES ('1', 'initial');
