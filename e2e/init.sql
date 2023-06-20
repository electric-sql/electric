CREATE TABLE entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content VARCHAR(64) NOT NULL,
  content_b VARCHAR(64)
);

CREATE TABLE owned_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  electric_user_id VARCHAR(255) NOT NULL,
  content VARCHAR(64) NOT NULL
);
