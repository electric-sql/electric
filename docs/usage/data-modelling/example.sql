CREATE TABLE users (
  username text NOT NULL PRIMARY KEY,

  inserted_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL
);

CREATE TABLE projects (
  id uuid NOT NULL PRIMARY KEY,
  name text NOT NULL,

  owner_id text NOT NULL REFERENCES users(username) ON DELETE CASCADE ON UPDATE CASCADE,

  inserted_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL
);

CREATE TABLE memberships (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  user_id text NOT NULL REFERENCES users(username) ON DELETE CASCADE ON UPDATE CASCADE,

  inserted_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE issues (
  id uuid NOT NULL PRIMARY KEY,
  title text NOT NULL,
  description text,

  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,

  inserted_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL
);

CREATE TABLE comments (
  id uuid NOT NULL PRIMARY KEY,
  content text NOT NULL,

  author_id text NOT NULL REFERENCES users(username) ON DELETE CASCADE ON UPDATE CASCADE,
  issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE ON UPDATE CASCADE,

  inserted_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL
);
