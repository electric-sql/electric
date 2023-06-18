
-- This function returns information about columns of the table based on it's oid, skipping any columns starting with an underscore
CREATE OR REPLACE FUNCTION electric.lookup_columns(search_oid oid, include_hidden_columns boolean DEFAULT false)
    RETURNS TABLE (col_name name, col_type text, col_not_null boolean, col_default text, col_primary boolean)
    STABLE PARALLEL SAFE
    RETURNS NULL ON NULL INPUT
    ROWS 10
    LANGUAGE SQL AS $$
        SELECT
            attname AS col_name,
            pg_catalog.format_type(atttypid, atttypmod) AS col_type,
            attnotnull AS col_not_null,
            pg_get_expr(adbin, adrelid) AS col_default,
            indexrelid IS NOT NULL AS col_primary
        FROM pg_attribute
        LEFT JOIN pg_attrdef
            ON attrelid = adrelid AND attnum = adnum
        LEFT JOIN pg_index
            ON attrelid = indrelid AND attnum = ANY(indkey) AND indisprimary
        WHERE
            attrelid = search_oid
            AND attnum > 0
            AND (include_hidden_columns OR attname NOT LIKE '\_%')
        ORDER BY attnum
    $$;

-- This function creates or updates shadow tables for conflict resolution
CREATE OR REPLACE FUNCTION electric.ddlx_make_or_update_shadow_tables(tag text, schema_name text, target_oid oid)
    RETURNS VOID
    LANGUAGE PLPGSQL AS $function$
DECLARE
    cols RECORD;
    sql_statement TEXT := '';
    reordered_column_definitions TEXT := '';
    shadow_column_definitions TEXT := '';
    tombstone_column_definitions TEXT := '';
    primary_key_list TEXT[];
    non_pk_column_list TEXT[] := array[]::TEXT[];
    table_name TEXT;
    full_table_identifier TEXT;
    generated_functions JSONB;
    shadow_table_name NAME;
    tombstone_table_name NAME;
    shadow_table_oid oid;
    tombstone_table_oid oid;
BEGIN
    -- Get table name to modify
    SELECT relname INTO table_name FROM pg_class WHERE oid = target_oid;
    shadow_table_name := 'shadow__' || schema_name || '__' || table_name;
    tombstone_table_name := 'tombstone__' || schema_name || '__' || table_name;

    -- Get primary keys
    SELECT array_agg(attname ORDER BY array_position(indkey, attnum))
        INTO primary_key_list
    FROM pg_index JOIN pg_attribute ON attrelid = indrelid AND attnum = ANY(indkey) AND indisprimary
    WHERE indrelid = target_oid;


    IF tag = 'CREATE TABLE' THEN
        -- Table got created, so we need to just copy it's structure for the shadow table

        -- Get a list of columns, which are going to be used in both shadow and the tombstone tables
        FOR cols IN
            SELECT * from electric.lookup_columns(target_oid)
        LOOP
            -- Shadow table primary key duplicates the one on the main table, but other columns are of the `tag` type
            shadow_column_definitions :=
                shadow_column_definitions
                || format(E'    %I %s,\n', cols.col_name, (CASE WHEN cols.col_primary THEN cols.col_type || ' NOT NULL' ELSE 'electric.tag' END));

            -- Reordered columns have the same type as the original columns, but will be stored in a shadow table.
            -- PK columns aren't reordered since we consider them immutable
            -- They are also always nullable, so that we can reset them to null after reordering is done.
            IF NOT cols.col_primary THEN
                reordered_column_definitions :=
                  reordered_column_definitions
                  || format(E'    %I %s,\n', '__reordered_' || cols.col_name, cols.col_type);
                
                -- We're also building up a non-pk column name list, that's going to be used in trigger function creation
                non_pk_column_list := non_pk_column_list || cols.col_name;
            END IF;

            -- Tombstone table copies the original table structure, since we're going to copy deleted rows there
            tombstone_column_definitions :=
                tombstone_column_definitions
                || format(E'    %I %s %sNULL,\n', cols.col_name, cols.col_type, (CASE WHEN cols.col_not_null THEN 'NOT ' ELSE '' END));

        END LOOP;

        -- Create a shadow table in the electric namespace and using the table name with `shadow__` prefix
        -- If you update or modify this table structure, please make sure it is fully reflected in `Electric.Postgres.Schema.build_shadow_table/1`
        EXECUTE format(
            E'CREATE TABLE electric.%I (\n'
            '    _tags electric.tag[] DEFAULT array[]::electric.tag[],\n'
            '    _last_modified bigint,\n'
            '    _is_a_delete_operation boolean DEFAULT false,\n'
            '    _tag electric.tag,\n'
            '    _observed_tags electric.tag[],\n'
            '    _modified_columns_bit_mask boolean[],\n'
            '    _resolved boolean,\n'
            '    _currently_reordering boolean,\n'
            '%s'
            '%s'
            '    PRIMARY KEY(%s)\n'
            ')',
            shadow_table_name,
            reordered_column_definitions,
            shadow_column_definitions,
            electric.format_every_and_join(primary_key_list, '%I')
        );

        EXECUTE format('ALTER TABLE electric.%I REPLICA IDENTITY FULL', shadow_table_name);

        -- Create a tombstone table in the electric namespace and using the table name with `tombstone__` prefix
        EXECUTE format(
            E'CREATE TABLE electric.%I (\n'
            '%s'
            '    PRIMARY KEY(%s)\n'
            ')',
            tombstone_table_name,
            tombstone_column_definitions,
            electric.format_every_and_join(primary_key_list, '%I')
        );

        -- We install generate functions for newly created tables & triggers using those functions
        PERFORM electric.install_functions_and_triggers(schema_name, table_name, primary_key_list, non_pk_column_list);
    ELSIF tag = 'ALTER TABLE' THEN
        -- Table got altered. Since we currently only support additive migrations,
        -- this can only be a column addition, but we can prepare for the future a little and query for more possible cases

        -- Find the shadow table oid
        SELECT pg_class.oid INTO shadow_table_oid
            FROM pg_class JOIN pg_namespace ON relnamespace = pg_namespace.oid
            WHERE relname = shadow_table_name AND nspname = 'electric';

        SELECT pg_class.oid INTO tombstone_table_oid
            FROM pg_class JOIN pg_namespace ON relnamespace = pg_namespace.oid
            WHERE relname = tombstone_table_name AND nspname = 'electric';

        RAISE DEBUG 'TARGET (%) %', target_oid, (SELECT to_json(array_agg(t)) FROM (SELECT * FROM electric.lookup_columns(target_oid)) t);
        RAISE DEBUG 'TOMBSTONE (%) %', tombstone_table_oid, (SELECT to_json(array_agg(t)) FROM (SELECT * FROM electric.lookup_columns(tombstone_table_oid)) t);

        -- Get all columns that are different between the main table & the shadow table:
        -- either missing or changed type.
        -- TODO: Support or guard against column removal and/or type changes.
        --       Also we currently ignore defaults and NULL constraints. This is fine
        --       since only our triggers should write to these tables anyhow
        FOR cols IN
            WITH main AS (SELECT * FROM electric.lookup_columns(target_oid)),
                 tomb AS (SELECT * FROM electric.lookup_columns(tombstone_table_oid))
            SELECT
                main.col_name as main_col_name,
                tomb.col_name as tomb_col_name,
                main.col_type as main_col_type,
                tomb.col_type as tomb_col_type
            FROM main
                FULL JOIN tomb ON main.col_name = tomb.col_name
            WHERE tomb.col_name IS NULL
                OR main.col_name IS NULL
                OR (main.col_name = tomb.col_name AND (main.col_type <> tomb.col_type))
        LOOP
            IF cols.tomb_col_name IS NULL THEN
                -- Shadow table is missing a column, meaning it got added
                shadow_column_definitions :=
                    shadow_column_definitions
                    || format(E'    ADD COLUMN %I electric.tag,\n', cols.main_col_name);

                reordered_column_definitions :=
                    reordered_column_definitions
                    || format(E'    ADD COLUMN %I %s,\n', '__reordered_' || cols.main_col_name, cols.main_col_type);

                -- Tombstone as well
                tombstone_column_definitions :=
                    tombstone_column_definitions
                    || format(E'    ADD COLUMN %I %s,\n', cols.main_col_name, cols.main_col_type);
            ELSEIF cols.main_col_name IS NULL THEN
                -- Main table is missing a column, meaning it got removed
                RAISE EXCEPTION 'Column removal is not an additive migration';
            ELSE
                -- Column exists in both tables, meaning the type got altered
                RAISE EXCEPTION 'Column type change is not an additive migration';
            END IF;
        END LOOP;

        -- true if loop executed at least once
        IF FOUND THEN
            shadow_column_definitions := left(shadow_column_definitions, -2);
            tombstone_column_definitions := left(tombstone_column_definitions, -2);

            EXECUTE format(
                E'ALTER TABLE electric.%I\n%s',
                shadow_table_name,
                reordered_column_definitions || shadow_column_definitions
            );

            EXECUTE format(
                E'ALTER TABLE electric.%I\n%s',
                tombstone_table_name,
                tombstone_column_definitions
            );

            SELECT array_agg(col_name) INTO non_pk_column_list
                FROM electric.lookup_columns(target_oid) WHERE NOT col_primary;

            /*
            We regenerate column-dependent functions, but not the triggers themselves since one of the triggers is `CREATE CONSTRAINT TRIGGER` which cannot be `CREATE OR REPLACE`-ed.
            This is a little less flexible (if trigger logic gets altered, `install_functions_and_triggers` will need to be reran explicitly) but safer since `DROP` + `CREATE`
            can have some unexpected effects.
            */
            PERFORM electric.install_conflict_resolution_functions(schema_name, table_name, primary_key_list, non_pk_column_list);
        END IF;
    END IF;
END;
$function$;
