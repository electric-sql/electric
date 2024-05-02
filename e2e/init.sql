CREATE DATABASE e2e_client_1_db;
CREATE DATABASE e2e_client_2_db;

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
