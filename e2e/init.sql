CREATE TABLE entries (
  id UUID PRIMARY KEY,
  content VARCHAR NOT NULL,
  content_b TEXT
);

CREATE TABLE owned_entries (
  id UUID PRIMARY KEY,
  electric_user_id TEXT NOT NULL,
  content VARCHAR NOT NULL
);
