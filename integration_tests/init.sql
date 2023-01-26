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
