-- This is the local database schema for PGlite. It mirrors the server schema
-- defined in `../../shared/migrations/01-create-todos.sql` but rather than
-- just defining a single `todos` table to sync into, it defines two tables:
-- `todos_synced` and `todos_local` and a `todos` view to combine them on read.

-- The `todos_synced` table for immutable, synced state from the server.
CREATE TABLE IF NOT EXISTS todos_synced (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  -- Extra `version` field auto-incremented on update on the server,
  -- used to detect server changes that superceed local state.
  version BIGINT NOT NULL
);

-- The `todos_local` table for local optimistic state. This mirrors the synced
-- table but allows column values to be nullable and has some additional
-- bookkeeping columnes to track changes. The "state" of a row is determined by
-- combining the local and synced tables.
CREATE TABLE IF NOT EXISTS todos_local (
  id UUID PRIMARY KEY,
  title TEXT,
  completed BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE,
  -- Track which columns have changed locally. A changed column from the local
  -- table will overrides the value in the synced table when combined on read.
  changed_columns TEXT[],
  -- Is this a new row or an update to an existing one?
  is_new BOOLEAN DEFAULT FALSE,
  -- Has the row been deleted locally?
  is_deleted BOOLEAN DEFAULT FALSE,
  -- Track the offset prefix at which the row was synced.
  synced_at BIGINT
);

-- The `todos` view to combine the two tables on read.
--
-- Takes the synced table and overlays the local changes on top of it. Rows ids
-- that have a match in the local table are "changed", and the vales from that
-- local row are used in preference to the values in the synced table. Rows in
-- the local table but not in the synced table are "added". Rows marked as deleted
-- in the local table are excluded from the view.
CREATE OR REPLACE VIEW todos AS
  SELECT
    COALESCE(local.id, synced.id) AS id,
    CASE
      WHEN 'title' = ANY(local.changed_columns)
        THEN local.title
        ELSE synced.title
      END AS title,
    CASE
      WHEN 'completed' = ANY(local.changed_columns)
        THEN local.completed
        ELSE synced.completed
      END AS completed,
    CASE
      WHEN 'created_at' = ANY(local.changed_columns)
        THEN local.created_at
        ELSE synced.created_at
      END AS created_at
  FROM todos_synced AS synced
  FULL OUTER JOIN todos_local AS local ON synced.id = local.id
  WHERE local.id IS NULL OR local.is_deleted = FALSE;

-- We now add two triggers that automatically remove local optimistic state
-- when the synced state is updated.

-- First clear a row from the local table if its is deleted from the synced table.
CREATE OR REPLACE FUNCTION delete_local_on_synced_delete_trigger()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM todos_local WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER delete_local_on_synced_delete
AFTER DELETE ON todos_synced
FOR EACH ROW
EXECUTE FUNCTION delete_local_on_synced_delete_trigger();

-- Secondly, clear a row from the local table if its been superceeded by a more
-- recent update to the synced table.
CREATE OR REPLACE FUNCTION delete_local_on_more_recent_synced_trigger()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM todos_local
  WHERE id = NEW.id AND synced_at IS NOT NULL AND NEW.version >= synced_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER delete_local_on_more_recent_synced
AFTER INSERT OR UPDATE ON todos_synced
FOR EACH ROW
EXECUTE FUNCTION delete_local_on_more_recent_synced_trigger();

-- Now, we define `INSTEAD OF` triggers to the view to redirect write operations
-- to the right table. Note that this is optional. You don't have to implement
-- these triggers. Instead, you could choose to write local optimistic state
-- directly to the `todos_local` table.
--
-- The benefit with these triggers is that:
--
-- 1. you can just read and write to and from the combined `todos` view as if it
--    were a single table.
-- 2. they validate the writes
--
-- The downside is that they add some non-trivial complexity to the local schema
-- definition. Whether this is worth the benefit is up to you.

-- The insert trigger:
--
-- 1. checks that the id is unique, i.e. not present in the synced table or local table.
-- 2. inserts the row into the local table.
-- 3. sets the "changed_columns" to list all the columns as they are all new.
-- 4. sets the "synced_at" to NULL, to indicate that the row has not been synced.
CREATE OR REPLACE FUNCTION todos_insert_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM todos_synced WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'Cannot insert: id already exists in the synced table';
  END IF;
  IF EXISTS (SELECT 1 FROM todos_local WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'Cannot insert: id already exists in the local table';
  END IF;

  INSERT INTO todos_local (
    id,
    title,
    completed,
    created_at,
    changed_columns,
    is_new,
    synced_at
  )
  VALUES (
    NEW.id,
    NEW.title,
    NEW.completed,
    NEW.created_at,
    ARRAY['title', 'completed', 'created_at'],
    TRUE,
    NULL
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER todos_insert
INSTEAD OF INSERT ON todos
FOR EACH ROW
EXECUTE FUNCTION todos_insert_trigger();

-- The update trigger:
--
-- 1. performs an upsert to the local table, setting the changed columns. i.e.
--    if the row is not present in the local table, it is inserted  If the row
--    is present, the columns that have changed are updated
-- 2. sets the changed_columns to list all the columns that may have diverged
--    from the synced table (i.e.: when updating a previous local change, it
--    combines both the old change and new change)
-- 3. sets synced_at to NULL, to indicate that the row has not been synced
CREATE OR REPLACE FUNCTION todos_update_trigger()
RETURNS TRIGGER AS $$
DECLARE
  synced todos_synced%ROWTYPE;
  local todos_local%ROWTYPE;
  changed_cols TEXT[] := '{}';
BEGIN
  -- Fetch the corresponding rows from the synced and local tables
  SELECT * INTO synced FROM todos_synced WHERE id = NEW.id;
  SELECT * INTO local FROM todos_local WHERE id = NEW.id;

  -- If the row is not present in the local table, insert it
  IF NOT FOUND THEN
    -- Compare each column with the synced table and add to changed_cols if different
    IF NEW.title IS DISTINCT FROM synced.title THEN
      changed_cols := array_append(changed_cols, 'title');
    END IF;
    IF NEW.completed IS DISTINCT FROM synced.completed THEN
      changed_cols := array_append(changed_cols, 'completed');
    END IF;
    IF NEW.created_at IS DISTINCT FROM synced.created_at THEN
      changed_cols := array_append(changed_cols, 'created_at');
    END IF;

    INSERT INTO todos_local (
      id,
      title,
      completed,
      created_at,
      changed_columns,
      synced_at
    )
    VALUES (
      NEW.id,
      NEW.title,
      NEW.completed,
      NEW.created_at,
      changed_cols,
      NULL
    );

  -- Otherwise, if the row is already in the local table, update it and adjust
  -- the changed_columns
  ELSE
    UPDATE todos_local
      SET
        title =
          CASE
            WHEN NEW.title IS DISTINCT FROM synced.title
              THEN NEW.title
              ELSE local.title
            END,
        completed =
          CASE
            WHEN NEW.completed IS DISTINCT FROM synced.completed
              THEN NEW.completed
              ELSE local.completed
            END,
        created_at =
          CASE
            WHEN NEW.created_at IS DISTINCT FROM synced.created_at
              THEN NEW.created_at
              ELSE local.created_at
            END,
        -- Set the changed_columns to columes that have both been marked as changed
        -- and have values that have actually changed.
        changed_columns = (
          SELECT array_agg(DISTINCT col) FROM (
            SELECT unnest(local.changed_columns) AS col
            UNION
            SELECT unnest(ARRAY['title', 'completed', 'created_at']) AS col
          ) AS cols
          WHERE (
            CASE
              WHEN col = 'title'
                THEN COALESCE(NEW.title, local.title) IS DISTINCT FROM synced.title
              WHEN col = 'completed'
                THEN COALESCE(NEW.completed, local.completed) IS DISTINCT FROM synced.completed
              WHEN col = 'created_at'
                THEN COALESCE(NEW.created_at, local.created_at) IS DISTINCT FROM synced.created_at
              END
          )
        ),
        synced_at = NULL
      WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER todos_update
INSTEAD OF UPDATE ON todos
FOR EACH ROW
EXECUTE FUNCTION todos_update_trigger();

-- The delete trigger:
--
-- 1. sets the is_deleted flag to true for the row in the local table; if the
--    row is not present in the local table, it is inserted
-- 2. sets synced_at to NULL, to indicate that the row has not been synced
CREATE OR REPLACE FUNCTION todos_delete_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM todos_local WHERE id = OLD.id) THEN
    UPDATE todos_local
    SET
      is_deleted = TRUE,
      synced_at = NULL
    WHERE id = OLD.id;
  ELSE
    INSERT INTO todos_local (
      id,
      is_deleted,
      synced_at
    )
    VALUES (
      OLD.id,
      TRUE,
      NULL
    );
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER todos_delete
INSTEAD OF DELETE ON todos
FOR EACH ROW
EXECUTE FUNCTION todos_delete_trigger();
