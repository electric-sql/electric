-- This is the local database schema for PGlite. It mirrors the server schema
-- defined in `../../shared/migrations/01-create-todos.sql` but rather than
-- just defining a single `todos` table to sync into, it defines two tables:
-- `todos_synced` and `todos_local` and a `todos` view to combine on read.

-- The `todos_synced` table for immutable, synced state from the server.
CREATE TABLE IF NOT EXISTS todos_synced (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- The `todos_local` table for local optimistic state.
CREATE TABLE IF NOT EXISTS todos_local (
  id UUID PRIMARY KEY,
  title TEXT,
  completed BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE,
  -- Track soft deletes
  deleted BOOLEAN DEFAULT FALSE
);

-- The `todos` view to combine the two tables on read.
CREATE OR REPLACE VIEW todos AS
  SELECT
    COALESCE(local.id, synced.id) AS id,
    CASE WHEN local.title IS NOT NULL
      THEN local.title
      ELSE synced.title
    END AS title,
    CASE WHEN local.completed IS NOT NULL
      THEN local.completed
      ELSE synced.completed
    END AS completed,
    CASE WHEN local.created_at IS NOT NULL
      THEN local.created_at
      ELSE synced.created_at
    END AS created_at
  FROM todos_synced AS synced
  FULL OUTER JOIN todos_local AS local
    ON synced.id = local.id
    WHERE local.id IS NULL OR local.deleted = FALSE;

-- Automatically remove local optimistic state.
CREATE OR REPLACE FUNCTION delete_local_on_sync_trigger()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM todos_local WHERE id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER delete_local_on_sync
AFTER INSERT OR UPDATE OR DELETE ON todos_synced
FOR EACH ROW
EXECUTE FUNCTION delete_local_on_sync_trigger();
