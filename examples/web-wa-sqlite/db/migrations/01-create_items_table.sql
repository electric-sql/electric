BEGIN;

CREATE EXTENSION vector;

-- Pin the migration version
CALL electric.migration_version('20240129154650_919');

-- Create the tables for the linearlite example
CREATE TABLE IF NOT EXISTS "issue" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "modified" TEXT NOT NULL,
    "created" TEXT NOT NULL,
    "kanbanorder" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    -- "embeddings" TEXT NOT NULL, -- Embeddings, for the tauri demo
    "embeddings" vector(768), -- Embeddings, for the tauri demo
    CONSTRAINT "issue_pkey" PRIMARY KEY ("id")
);

-- CREATE TABLE IF NOT EXISTS "user" (
--     "username" TEXT NOT NULL,
--     "avatar" TEXT,
--     CONSTRAINT "user_pkey" PRIMARY KEY ("username")
-- );

CREATE TABLE  IF NOT EXISTS "comment" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
    -- FOREIGN KEY (username) REFERENCES "user"(username),
    -- FOREIGN KEY (issue_id) REFERENCES issue(id) -- Disable for the tauri demo
);

-- ⚡
-- Electrify the tables
ALTER TABLE issue ENABLE ELECTRIC;
ALTER TABLE comment ENABLE ELECTRIC;

COMMIT;
