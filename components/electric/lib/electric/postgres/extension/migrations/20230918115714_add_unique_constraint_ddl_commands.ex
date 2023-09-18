defmodule Electric.Postgres.Extension.Migrations.Migration_20230918115714_DDLCommandUniqueConstraint do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @txid_type "xid8"

  @impl true
  def version, do: 2023_09_18_11_57_14

  @impl true
  def up(schema) do
    ddl_table = Extension.ddl_table()

    [
      """
      ALTER TABLE #{ddl_table}
        ADD CONSTRAINT ddl_table_unique_migrations
        UNIQUE (txid, txts ,version, query); 
      """,
      """
      CREATE OR REPLACE FUNCTION #{schema}.create_active_migration(
          _txid #{@txid_type},
          _txts timestamptz,
          _version text,
          _query text DEFAULT NULL
      ) RETURNS int8 AS
      $function$
      DECLARE
          trid int8;
      BEGIN
          IF _query IS NULL THEN
              _query := current_query();
          END IF;
          RAISE NOTICE 'capture migration: % => %', _version, _query;
          INSERT INTO #{ddl_table} (txid, txts, version, query) VALUES
                (_txid, _txts, _version, _query)
              ON CONFLICT ON CONSTRAINT ddl_table_unique_migrations DO NOTHING
              RETURNING id INTO trid;
          RETURN trid;
      END;
      $function$
      LANGUAGE PLPGSQL;
      """
    ]
  end

  @impl true
  def down(_), do: []
end
