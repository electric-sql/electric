defmodule Electric.Postgres.Extension.Migrations.Migration_20230512000000_conflict_resolution_triggers do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  files =
    "20230512000000_conflict_resolution_triggers/*.sql"
    |> Path.expand(__DIR__)
    |> Path.wildcard()

  for file <- files, do: @external_resource(file)

  @contents for file <- files, into: %{}, do: {Path.basename(file, ".sql"), File.read!(file)}

  @txid_type "xid8"

  @impl true
  def version, do: 2023_05_12_00_00_00

  @impl true
  def up(schema) do
    [
      @contents["electric_tag_type_and_operators"],
      @contents["utility_functions"],
      @contents["trigger_function_installers"],
      @contents["shadow_table_creation_and_update"],
      # This next function is overridden in the next migration
      """
      CREATE OR REPLACE FUNCTION #{schema}.ddlx_command_end_handler() RETURNS EVENT_TRIGGER AS
      $function$
      DECLARE
          _txid #{@txid_type};
          _txts timestamptz;
          _version text;
          trid int8;
          v_cmd_rec record;
          _capture bool;
      BEGIN
          -- Usually, this would be a great place for `pg_trigger_depth()`, but for event triggers that's always
          IF (current_setting('electric.is_in_event_trigger', true) = 'true') THEN RETURN; END IF;
          RAISE DEBUG 'command_end_handler:: version: % :: start (depth %)', _version, pg_trigger_depth();

          SELECT v.txid, v.txts, v.version
            INTO _txid, _txts, _version
            FROM #{schema}.current_migration_version() v;

          trid := (SELECT #{schema}.create_active_migration(_txid, _txts, _version));

          -- We're maybe going to create multiple tables here. We don't want to re-trigger this function
          PERFORM set_config('electric.is_in_event_trigger', 'true', true);
          FOR v_cmd_rec IN (SELECT * FROM pg_event_trigger_ddl_commands())
          LOOP
              RAISE DEBUG '  Current statement touches a % in schema % with objid %', v_cmd_rec.object_type, v_cmd_rec.schema_name, v_cmd_rec.object_identity;
              IF v_cmd_rec.object_type = 'table' AND v_cmd_rec.schema_name <> '#{schema}' THEN
                  PERFORM electric.ddlx_make_or_update_shadow_tables(v_cmd_rec.command_tag, v_cmd_rec.schema_name, v_cmd_rec.objid);
              END IF;
          END LOOP;
          PERFORM set_config('electric.is_in_event_trigger', '', true);

          RAISE DEBUG 'create_active_migration = %', trid;
          RAISE DEBUG 'command_end_handler:: version: % :: end', _version;
      END;
      $function$
      LANGUAGE PLPGSQL;
      """
    ]
    |> Enum.map(&String.replace(&1, "electric", schema))
  end

  @impl true
  def down(_schema) do
    []
  end
end
