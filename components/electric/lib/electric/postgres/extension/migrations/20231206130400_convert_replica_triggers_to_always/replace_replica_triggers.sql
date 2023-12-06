CREATE FUNCTION electric.tmp_select_from_pg_trigger(trigger_name name, OUT tgrelid regclass, OUT tgfoid regproc)
STABLE
SECURITY DEFINER
AS $sql_body$
  SELECT DISTINCT tgrelid, tgfoid
             FROM pg_trigger
            WHERE NOT tgisinternal
                  AND tgenabled IN ('O', 'R')
                  AND tgname = $1
$sql_body$
LANGUAGE SQL;

DO $do_body$
DECLARE
  shadow_table_identifier regclass;
  user_table_identifier regclass;
  trigger_function_identifier regproc;
BEGIN
  ---
  -- Reinstall origin/local triggers to check the value of `electric__session_replication_role()` in their WHEN clause
  ---

  SELECT INTO user_table_identifier, trigger_function_identifier
    * FROM electric.tmp_select_from_pg_trigger('postgres_write__upsert_generate_shadow_rows');

  IF user_table_identifier IS NOT NULL THEN
    EXECUTE format($$
      CREATE OR REPLACE TRIGGER postgres_write__upsert_generate_shadow_rows
      BEFORE INSERT OR UPDATE ON %s
      FOR EACH ROW
      WHEN (electric.__session_replication_role() <> 'replica')
      EXECUTE PROCEDURE %s();
    $$, user_table_identifier, trigger_function_identifier);

    EXECUTE format($$ ALTER TABLE %s ENABLE TRIGGER postgres_write__upsert_generate_shadow_rows $$, user_table_identifier);
  END IF;

  ---

  SELECT INTO user_table_identifier, trigger_function_identifier
    * FROM electric.tmp_select_from_pg_trigger('postgres_write__delete_generate_shadow_rows');

  IF user_table_identifier IS NOT NULL THEN
    EXECUTE format($$
        CREATE OR REPLACE TRIGGER postgres_write__delete_generate_shadow_rows
        BEFORE DELETE ON %s
        FOR EACH ROW
        WHEN (electric.__session_replication_role() <> 'replica')
        EXECUTE PROCEDURE %s();
    $$, user_table_identifier, trigger_function_identifier);

    EXECUTE format($$ ALTER TABLE %s ENABLE TRIGGER postgres_write__delete_generate_shadow_rows $$, user_table_identifier);
  END IF;

  ---

  SELECT INTO shadow_table_identifier, trigger_function_identifier
    * FROM electric.tmp_select_from_pg_trigger('postgres_write__write_resolved_tags');

  IF shadow_table_identifier IS NOT NULL THEN
    EXECUTE format($$ DROP TRIGGER IF EXISTS postgres_write__write_resolved_tags ON %s $$, shadow_table_identifier);

    EXECUTE format($$
        CREATE CONSTRAINT TRIGGER postgres_write__write_resolved_tags
        AFTER UPDATE ON %s
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        WHEN (electric.__session_replication_role() <> 'replica' AND NOT NEW._resolved)
        EXECUTE PROCEDURE %s();
    $$, shadow_table_identifier, trigger_function_identifier);

    EXECUTE format($$ ALTER TABLE %s ENABLE TRIGGER postgres_write__write_resolved_tags $$, shadow_table_identifier);
  END IF;

  ---
  -- Reinstall shadow table replica triggers with ENABLE ALWAYS
  ---

  SELECT INTO shadow_table_identifier, trigger_function_identifier
    * FROM electric.tmp_select_from_pg_trigger('satellite_write__upsert_rows');

  IF shadow_table_identifier IS NOT NULL THEN
    EXECUTE format($$
      CREATE OR REPLACE TRIGGER satellite_write__upsert_rows
      BEFORE INSERT ON %s
      FOR EACH ROW
      WHEN (electric.__session_replication_role() = 'replica' AND pg_trigger_depth() < 1 AND NEW._currently_reordering IS NULL)
      EXECUTE PROCEDURE %s();
    $$, shadow_table_identifier, trigger_function_identifier);

    EXECUTE format($$ ALTER TABLE %s ENABLE ALWAYS TRIGGER satellite_write__upsert_rows $$, shadow_table_identifier);
  END IF;

  ---

  SELECT INTO shadow_table_identifier, trigger_function_identifier
    * FROM electric.tmp_select_from_pg_trigger('satellite_write__resolve_observed_tags');

  IF shadow_table_identifier IS NOT NULL THEN
    EXECUTE format($$
      CREATE OR REPLACE TRIGGER satellite_write__resolve_observed_tags
      BEFORE UPDATE ON %s
      FOR EACH ROW
      WHEN (electric.__session_replication_role() = 'replica' AND NEW._currently_reordering IS NULL)
      EXECUTE PROCEDURE %s();
    $$, shadow_table_identifier, trigger_function_identifier);

    EXECUTE format($$ ALTER TABLE %s ENABLE ALWAYS TRIGGER satellite_write__resolve_observed_tags $$, shadow_table_identifier);
  END IF;

  ---
  -- Reinstall the user table replica trigger with ENABLE ALWAYS
  ---

  SELECT INTO user_table_identifier, trigger_function_identifier
    * FROM electric.tmp_select_from_pg_trigger('satellite_write__save_operation_for_reordering');

  IF user_table_identifier IS NOT NULL THEN
    EXECUTE format($$
      CREATE OR REPLACE TRIGGER satellite_write__save_operation_for_reordering
      BEFORE INSERT OR UPDATE ON %s
      FOR EACH ROW
      WHEN (electric.__session_replication_role() = 'replica' AND pg_trigger_depth() < 1)
      EXECUTE PROCEDURE %s();
    $$, user_table_identifier, trigger_function_identifier);

    EXECUTE format($$ ALTER TABLE %s ENABLE ALWAYS TRIGGER satellite_write__save_operation_for_reordering $$, user_table_identifier);
  END IF;
END $do_body$;

DROP FUNCTION electric.tmp_select_from_pg_trigger;
