-- This is the local database schema for PGlite.

-- Note that the resources are prefixed by a `p4` namespace (standing for pattern 4)
-- in order to avoid clashing with the resources defined in pattern 3.

-- The `p4_todos_synced` table for immutable, synced state from the server.
CREATE TABLE IF NOT EXISTS p4_todos_synced (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- The `p4_todos_local` table for local optimistic state.
CREATE TABLE IF NOT EXISTS p4_todos_local (
  id UUID PRIMARY KEY,
  title TEXT,
  completed BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE,
  changed_columns TEXT[],
  is_deleted BOOLEAN DEFAULT FALSE
);

-- The `p4_todos` view to combine the two tables on read.
CREATE OR REPLACE VIEW p4_todos AS
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
  FROM p4_todos_synced AS synced
  FULL OUTER JOIN p4_todos_local AS local
    ON synced.id = local.id
    WHERE local.id IS NULL OR local.is_deleted = FALSE;

-- A trigger to automatically remove local optimistic state.
CREATE OR REPLACE FUNCTION p4_delete_local_on_sync_trigger()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM p4_todos_local WHERE id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER p4_delete_local_on_sync
AFTER INSERT OR UPDATE OR DELETE ON p4_todos_synced
FOR EACH ROW
EXECUTE FUNCTION p4_delete_local_on_sync_trigger();

-- The local `changes` table for capturing and persisting a log
-- of local write operations that we want to sync to the server.
CREATE TABLE IF NOT EXISTS p4_changes (
  id BIGSERIAL PRIMARY KEY,
  operation TEXT NOT NULL,
  value JSONB NOT NULL,
  transaction_id XID8 NOT NULL
);

-- We now define `INSTEAD OF` triggers to:
-- 1. allow the app code to write directly to the view
-- 2. to capture write operations and write change messages into the

-- The insert trigger
CREATE OR REPLACE FUNCTION p4_todos_insert_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM p4_todos_synced WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'Cannot insert: id already exists in the synced table';
  END IF;
  IF EXISTS (SELECT 1 FROM p4_todos_local WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'Cannot insert: id already exists in the local table';
  END IF;

  INSERT INTO p4_todos_local (
    id,
    title,
    completed,
    created_at,
    changed_columns
  )
  VALUES (
    NEW.id,
    NEW.title,
    NEW.completed,
    NEW.created_at,
    ARRAY['title', 'completed', 'created_at']
  );

  INSERT INTO p4_changes (
    operation,
    value,
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
    pg_current_xact_id()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The update trigger
CREATE OR REPLACE FUNCTION p4_todos_update_trigger()
RETURNS TRIGGER AS $$
DECLARE
  synced p4_todos_synced%ROWTYPE;
  local p4_todos_local%ROWTYPE;
  changed_cols TEXT[] := '{}';
BEGIN
  -- Fetch the corresponding rows from the synced and local tables
  SELECT * INTO synced FROM p4_todos_synced WHERE id = NEW.id;
  SELECT * INTO local FROM p4_todos_local WHERE id = NEW.id;

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

    INSERT INTO p4_todos_local (
      id,
      title,
      completed,
      created_at,
      changed_columns
    )
    VALUES (
      NEW.id,
      NEW.title,
      NEW.completed,
      NEW.created_at,
      changed_cols
    );

  -- Otherwise, if the row is already in the local table, update it and adjust
  -- the changed_columns
  ELSE
    UPDATE p4_todos_local
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
        )
      WHERE id = NEW.id;
  END IF;

  INSERT INTO p4_changes (
    operation,
    value,
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
    pg_current_xact_id()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The delete trigger
CREATE OR REPLACE FUNCTION p4_todos_delete_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM p4_todos_local WHERE id = OLD.id) THEN
    UPDATE p4_todos_local
    SET
      is_deleted = TRUE
    WHERE id = OLD.id;
  ELSE
    INSERT INTO p4_todos_local (
      id,
      is_deleted
    )
    VALUES (
      OLD.id,
      TRUE
    );
  END IF;

  INSERT INTO p4_changes (
    operation,
    value,
    transaction_id
  )
  VALUES (
    'delete',
    jsonb_build_object(
      'id', OLD.id
    ),
    pg_current_xact_id()
  );

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER p4_todos_insert
INSTEAD OF INSERT ON p4_todos
FOR EACH ROW
EXECUTE FUNCTION p4_todos_insert_trigger();

CREATE OR REPLACE TRIGGER p4_todos_update
INSTEAD OF UPDATE ON p4_todos
FOR EACH ROW
EXECUTE FUNCTION p4_todos_update_trigger();

CREATE OR REPLACE TRIGGER p4_todos_delete
INSTEAD OF DELETE ON p4_todos
FOR EACH ROW
EXECUTE FUNCTION p4_todos_delete_trigger();

CREATE OR REPLACE FUNCTION p4_changes_notify_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NOTIFY p4_changes;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER p4_changes_notify
AFTER INSERT ON p4_changes
FOR EACH ROW
EXECUTE FUNCTION p4_changes_notify_trigger();
