CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA electric;
CREATE TABLE electric.migrations (
  id SERIAL PRIMARY KEY,
  version VARCHAR(64) NOT NULL,
  hash VARCHAR(64) NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(version)
);

INSERT INTO electric.migrations (version, hash) VALUES ('1', 'initial');

CREATE OR REPLACE FUNCTION upsert_from_replication_stream_insert()
RETURNS TRIGGER AS $$
DECLARE
  _table_name text;
  _schema_name text;
  _primary_key_cols text[];
  _column_list text[];
  _insert_columns text;
  _update_columns text;
  _values_clause text;
  _column_name text;
  _quoted_value text;
BEGIN
  _table_name := TG_TABLE_NAME;
  _schema_name := TG_TABLE_SCHEMA;

  -- Get the primary key and column names
  SELECT array_agg(column_name)
  INTO _column_list
  FROM information_schema.columns
  WHERE table_schema = _schema_name AND table_name = _table_name;

  SELECT array_agg(a.attname ORDER BY i.indkey)
  INTO _primary_key_cols
  FROM
    pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_attribute a ON a.attrelid = c.oid
      AND a.attnum = ANY (i.indkey)
    JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE
    relname = _table_name AND nspname = _schema_name
    AND indisprimary;

  -- Build clauses
  _insert_columns := format('(%s)', array_to_string(_column_list, ', '));
  _update_columns := (SELECT string_agg(column_name || ' = EXCLUDED.' || column_name, ', ') FROM unnest(_column_list) AS t(column_name) WHERE column_name != ALL (_primary_key_cols));

  _values_clause := '';
  FOREACH _column_name IN ARRAY _column_list LOOP
    EXECUTE 'SELECT quote_nullable($1.' || quote_ident(_column_name) || ')'
    INTO _quoted_value
    USING NEW;
    _values_clause := _values_clause || _quoted_value || ', ';
  END LOOP;
  _values_clause := format('(%s)', rtrim(_values_clause, ', '));


  EXECUTE format('
    INSERT INTO %I.%I %s
    VALUES %s
    ON CONFLICT (%s)
    DO UPDATE SET %s',
    _schema_name,
    _table_name,
    _insert_columns,
    _values_clause,
    array_to_string(_primary_key_cols, ', '),
    _update_columns
  );

  -- Skip the original UPDATE operation
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
