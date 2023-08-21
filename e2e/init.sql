CREATE TABLE entries (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4(),
  content VARCHAR NOT NULL,
  content_b TEXT
);

CREATE TABLE owned_entries (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4(),
  electric_user_id TEXT NOT NULL,
  content VARCHAR NOT NULL
);
