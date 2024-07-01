DO $do_body$
DECLARE
  trigger_name name;
  table_identifier regclass;
  trigger_function_identifier regproc;
BEGIN
  FOR trigger_name, table_identifier, trigger_function_identifier IN
    SELECT DISTINCT tgname, tgrelid::regclass, tgfoid::regproc FROM pg_trigger WHERE NOT tgisinternal AND tgenabled IN ('O', 'R')
  LOOP
    ---
    -- Reinstall origin/local triggers to check the value of `electric__session_replication_role()` in their WHEN clause
    ---

    IF trigger_name = 'postgres_write__upsert_generate_shadow_rows' THEN
      EXECUTE format($$
        CREATE OR REPLACE TRIGGER postgres_write__upsert_generate_shadow_rows
        BEFORE INSERT OR UPDATE ON %s
        FOR EACH ROW
        WHEN (electric.__session_replication_role() <> 'replica')
        EXECUTE PROCEDURE %s();
      $$, table_identifier, trigger_function_identifier);

      EXECUTE format($$ ALTER TABLE %s ENABLE TRIGGER postgres_write__upsert_generate_shadow_rows $$, table_identifier);
    END IF;

    ---

    IF trigger_name = 'postgres_write__delete_generate_shadow_rows' THEN
      EXECUTE format($$
          CREATE OR REPLACE TRIGGER postgres_write__delete_generate_shadow_rows
          BEFORE DELETE ON %s
          FOR EACH ROW
          WHEN (electric.__session_replication_role() <> 'replica')
          EXECUTE PROCEDURE %s();
      $$, table_identifier, trigger_function_identifier);

      EXECUTE format($$ ALTER TABLE %s ENABLE TRIGGER postgres_write__delete_generate_shadow_rows $$, table_identifier);
    END IF;

    ---

    IF trigger_name = 'postgres_write__write_resolved_tags' THEN
      EXECUTE format($$ DROP TRIGGER IF EXISTS postgres_write__write_resolved_tags ON %s $$, table_identifier);

      EXECUTE format($$
          CREATE CONSTRAINT TRIGGER postgres_write__write_resolved_tags
          AFTER UPDATE ON %s
          DEFERRABLE INITIALLY DEFERRED
          FOR EACH ROW
          WHEN (electric.__session_replication_role() <> 'replica' AND NOT NEW._resolved)
          EXECUTE PROCEDURE %s();
      $$, table_identifier, trigger_function_identifier);

      EXECUTE format($$ ALTER TABLE %s ENABLE TRIGGER postgres_write__write_resolved_tags $$, table_identifier);
    END IF;

    ---
    -- Reinstall shadow table replica triggers with ENABLE ALWAYS
    ---

    IF trigger_name = 'satellite_write__upsert_rows' THEN
      EXECUTE format($$
        CREATE OR REPLACE TRIGGER satellite_write__upsert_rows
        BEFORE INSERT ON %s
        FOR EACH ROW
        WHEN (electric.__session_replication_role() = 'replica' AND pg_trigger_depth() < 1 AND NEW._currently_reordering IS NULL)
        EXECUTE PROCEDURE %s();
      $$, table_identifier, trigger_function_identifier);

      EXECUTE format($$ ALTER TABLE %s ENABLE ALWAYS TRIGGER satellite_write__upsert_rows $$, table_identifier);
    END IF;

    ---

    IF trigger_name = 'satellite_write__resolve_observed_tags' THEN
      EXECUTE format($$
        CREATE OR REPLACE TRIGGER satellite_write__resolve_observed_tags
        BEFORE UPDATE ON %s
        FOR EACH ROW
        WHEN (electric.__session_replication_role() = 'replica' AND NEW._currently_reordering IS NULL)
        EXECUTE PROCEDURE %s();
      $$, table_identifier, trigger_function_identifier);

      EXECUTE format($$ ALTER TABLE %s ENABLE ALWAYS TRIGGER satellite_write__resolve_observed_tags $$, table_identifier);
    END IF;

    ---
    -- Reinstall the user table replica trigger with ENABLE ALWAYS
    ---

    IF trigger_name = 'satellite_write__save_operation_for_reordering' THEN
      EXECUTE format($$
        CREATE OR REPLACE TRIGGER satellite_write__save_operation_for_reordering
        BEFORE INSERT OR UPDATE ON %s
        FOR EACH ROW
        WHEN (electric.__session_replication_role() = 'replica' AND pg_trigger_depth() < 1)
        EXECUTE PROCEDURE %s();
      $$, table_identifier, trigger_function_identifier);

      EXECUTE format($$ ALTER TABLE %s ENABLE ALWAYS TRIGGER satellite_write__save_operation_for_reordering $$, table_identifier);
    END IF;
  END LOOP;
END $do_body$;
