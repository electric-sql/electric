-- This is the local database schema for PGlite.

-- It uses two tables: `todos_synced` and `todos_local`. These are combined
-- into a `todos` view that provides a merged view on both tables and supports
-- local live queries. Writes to the `todos` view are redirected using
-- `INSTEAD OF` triggers to the `todos_local` and `changes` tables.

-- The `todos_synced` table for immutable, synced state from the server.
CREATE TABLE IF NOT EXISTS todos_synced (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  -- Bookkeeping column.
  write_id UUID
);

-- The `todos_local` table for local optimistic state.
CREATE TABLE IF NOT EXISTS todos_local (
  id UUID PRIMARY KEY,
  title TEXT,
  completed BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE,
  -- Bookkeeping columns.
  changed_columns TEXT[],
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  write_id UUID NOT NULL
);

-- The `todos` view to combine the two tables on read.
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
  FULL OUTER JOIN todos_local AS local
    ON synced.id = local.id
    WHERE local.id IS NULL OR local.is_deleted = FALSE;

-- Triggers to automatically remove local optimistic state when the corresponding
-- row syncs over the replication stream. Match on `write_id`, to allow local
-- state to be rebased on concurrent changes to the same row.
CREATE OR REPLACE FUNCTION delete_local_on_synced_insert_and_update_trigger()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM todos_local
    WHERE id = NEW.id
      AND write_id IS NOT NULL
      AND write_id = NEW.write_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- N.b.: deletes can be concurrent, but can't update the `write_id` and aren't
-- revertable (once a row is deleted, it would be re-created with an insert),
-- so its safe to just match on ID. You could implement revertable concurrent
-- deletes using soft deletes (which are actually updates).
CREATE OR REPLACE FUNCTION delete_local_on_synced_delete_trigger()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM todos_local WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER delete_local_on_synced_insert
AFTER INSERT OR UPDATE ON todos_synced
FOR EACH ROW
EXECUTE FUNCTION delete_local_on_synced_insert_and_update_trigger();

-- The local `changes` table for capturing and persisting a log
-- of local write operations that we want to sync to the server.
CREATE TABLE IF NOT EXISTS changes (
  id BIGSERIAL PRIMARY KEY,
  operation TEXT NOT NULL,
  value JSONB NOT NULL,
  write_id UUID NOT NULL,
  transaction_id XID8 NOT NULL
);

-- The following `INSTEAD OF` triggers:
-- 1. allow the app code to write directly to the view
-- 2. to capture write operations and write change messages into the

-- The insert trigger
CREATE OR REPLACE FUNCTION todos_insert_trigger()
RETURNS TRIGGER AS $$
DECLARE
  local_write_id UUID := gen_random_uuid();
BEGIN
  IF EXISTS (SELECT 1 FROM todos_synced WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'Cannot insert: id already exists in the synced table';
  END IF;
  IF EXISTS (SELECT 1 FROM todos_local WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'Cannot insert: id already exists in the local table';
  END IF;

  -- Insert into the local table.
  INSERT INTO todos_local (
    id,
    title,
    completed,
    created_at,
    changed_columns,
    write_id
  )
  VALUES (
    NEW.id,
    NEW.title,
    NEW.completed,
    NEW.created_at,
    ARRAY['title', 'completed', 'created_at'],
    local_write_id
  );

  -- Record the write operation in the change log.
  INSERT INTO changes (
    operation,
    value,
    write_id,
    transaction_id
  )
  VALUES (
    'insert',
    jsonb_build_object(
      'id', NEW.id,
      'title', NEW.title,
      'completed', NEW.completed,
      'created_at', NEW.created_at
    ),
    local_write_id,
    pg_current_xact_id()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The update trigger
CREATE OR REPLACE FUNCTION todos_update_trigger()
RETURNS TRIGGER AS $$
DECLARE
  synced todos_synced%ROWTYPE;
  local todos_local%ROWTYPE;
  changed_cols TEXT[] := '{}';
  local_write_id UUID := gen_random_uuid();
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
      write_id
    )
    VALUES (
      NEW.id,
      NEW.title,
      NEW.completed,
      NEW.created_at,
      changed_cols,
      local_write_id
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
        write_id = local_write_id
      WHERE id = NEW.id;
  END IF;

  -- Record the update into the change log.
  INSERT INTO changes (
    operation,
    value,
    write_id,
    transaction_id
  )
  VALUES (
    'update',
    jsonb_strip_nulls(
      jsonb_build_object(
        'id', NEW.id,
        'title', NEW.title,
        'completed', NEW.completed,
        'created_at', NEW.created_at
      )
    ),
    local_write_id,
    pg_current_xact_id()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The delete trigger
CREATE OR REPLACE FUNCTION todos_delete_trigger()
RETURNS TRIGGER AS $$
DECLARE
  local_write_id UUID := gen_random_uuid();
BEGIN
  -- Upsert a soft-deletion record in the local table.
  IF EXISTS (SELECT 1 FROM todos_local WHERE id = OLD.id) THEN
    UPDATE todos_local
    SET
      is_deleted = TRUE,
      write_id = local_write_id
    WHERE id = OLD.id;
  ELSE
    INSERT INTO todos_local (
      id,
      is_deleted,
      write_id
    )
    VALUES (
      OLD.id,
      TRUE,
      local_write_id
    );
  END IF;

  -- Record in the change log.
  INSERT INTO changes (
    operation,
    value,
    write_id,
    transaction_id
  )
  VALUES (
    'delete',
    jsonb_build_object(
      'id', OLD.id
    ),
    local_write_id,
    pg_current_xact_id()
  );

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER todos_insert
INSTEAD OF INSERT ON todos
FOR EACH ROW
EXECUTE FUNCTION todos_insert_trigger();

CREATE OR REPLACE TRIGGER todos_update
INSTEAD OF UPDATE ON todos
FOR EACH ROW
EXECUTE FUNCTION todos_update_trigger();

CREATE OR REPLACE TRIGGER todos_delete
INSTEAD OF DELETE ON todos
FOR EACH ROW
EXECUTE FUNCTION todos_delete_trigger();

-- Notify on a `changes` topic whenever anything is added to the change log.
CREATE OR REPLACE FUNCTION changes_notify_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NOTIFY changes;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER changes_notify
AFTER INSERT ON changes
FOR EACH ROW
EXECUTE FUNCTION changes_notify_trigger();
