/*
 * COMMON TRIGGER FUNCTIONS
 */
CREATE OR REPLACE FUNCTION electric.install_function__generate_tombstone_entry(schema_name TEXT, table_name TEXT, primary_key_list TEXT[], non_pk_column_list TEXT[])
    RETURNS TEXT
    LANGUAGE PLPGSQL AS $outer_function$
DECLARE
    function_name TEXT := 'generate_tombstone_entry___' || schema_name || '__' || table_name;
    shadow_table_name TEXT := 'shadow__' || schema_name || '__' || table_name;
    tombstone_table_name TEXT := 'tombstone__' || schema_name || '__' || table_name;
    primary_key_where_clause TEXT;
    insertion_identifiers TEXT;
    values_from_old TEXT;
    on_conflict_assignment_block TEXT;
BEGIN
    -- pk1 = OLD.pk1 AND pk2 = OLD.pk2 ...
    primary_key_where_clause := electric.format_every_and_join(primary_key_list, '%1$I = OLD.%1$I', ' AND ');

    -- pk1, pk2, col1, col2 ...
    insertion_identifiers := electric.format_every_and_join(primary_key_list || non_pk_column_list, '%I');

    -- pk1, pk2, col1, col2 ...
    values_from_old := electric.format_every_and_join(primary_key_list || non_pk_column_list, 'OLD.%I');

    -- col1 = OLD.col1, col2 = OLD.col2 ...
    on_conflict_assignment_block := electric.format_every_and_join(non_pk_column_list, '        %1$I = OLD.%1$I');

    IF array_length(non_pk_column_list, 1) > 0 THEN
        on_conflict_assignment_block := E'DO UPDATE SET\n' || on_conflict_assignment_block;
    ELSE
        on_conflict_assignment_block := 'DO NOTHING'; -- Not much to really do for pk-only tables
    END IF;

    -- The `%n$I` placeholders use n-th argument for formatting.
    -- Generally, 1 is a function name, 2 is a shadow table name, 3 is a tombstone table name
    EXECUTE format($injected$
        CREATE OR REPLACE FUNCTION electric.%1$I()
        RETURNS TRIGGER
        LANGUAGE PLPGSQL SECURITY DEFINER AS
        $function$
        DECLARE
            shadow_row electric.%2$I%%ROWTYPE;
        BEGIN
            RAISE DEBUG 'Trigger %% executed by operation %% at depth %% (tx %%)', TG_NAME, TG_OP, pg_trigger_depth(), pg_current_xact_id();
            SELECT * INTO shadow_row FROM electric.%2$I WHERE %4$s;

            -- USES COLUMN LIST
            INSERT INTO electric.%3$I (%5$s)
                VALUES (%6$s)
                ON CONFLICT (%7$s) %8$s;

            RETURN NULL;
        END;
        $function$;$injected$,
    function_name,
    shadow_table_name,
    tombstone_table_name,
    primary_key_where_clause,
    insertion_identifiers,
    values_from_old,
    electric.format_every_and_join(primary_key_list, '%I'),
    on_conflict_assignment_block);

    RETURN function_name;
END;
$outer_function$;

/*
 * POSTGRES TRIGGER FUNCTIONS
 */
CREATE OR REPLACE FUNCTION electric.install_function__create_shadow_row_from_upsert(schema_name TEXT, table_name TEXT, primary_key_list TEXT[], non_pk_column_list TEXT[])
    RETURNS TEXT
    LANGUAGE PLPGSQL AS $outer_function$
DECLARE
    function_name TEXT := 'create_shadow_row_from_upsert___' || schema_name || '__' || table_name;
    shadow_table_name TEXT := 'shadow__' || schema_name || '__' || table_name;
    tombstone_table_name TEXT := 'tombstone__' || schema_name || '__' || table_name;
    tag_column_list TEXT[] := electric.format_every(non_pk_column_list, '_tag_%s');
    insertion_identifiers TEXT;
    insert_values TEXT;
    modified_columns_pattern TEXT;
    modified_columns_bitmask_merger TEXT := '';
BEGIN
    insertion_identifiers := electric.format_every_and_join(primary_key_list || tag_column_list, '%I');
    insert_values := electric.append_string_unless_empty(
        electric.format_every_and_join(primary_key_list, 'NEW.%I'),
        electric.format_every_and_join(tag_column_list, '__current_tag')
    );

    modified_columns_pattern := format('_modified_columns_bit_mask[%%2$s] = (NEW.%%1$I IS DISTINCT FROM OLD.%%1$I) OR COALESCE(%I._modified_columns_bit_mask[%%2$s], false)', shadow_table_name);
    modified_columns_bitmask_merger := electric.format_every_and_join(non_pk_column_list, modified_columns_pattern, E',\n');

    IF modified_columns_bitmask_merger != '' THEN
        modified_columns_bitmask_merger := E',\n-- REPEATED BLOCK PER COLUMN\n' || modified_columns_bitmask_merger;
    END IF;

    -- The `%n$I` placeholders use n-th argument for formatting.
    -- Generally, 1 is a function name, 2 is a shadow table name, 3 is a tombstone table name
    EXECUTE format($injected$
        CREATE OR REPLACE FUNCTION electric.%1$I()
        RETURNS TRIGGER
        LANGUAGE PLPGSQL SECURITY DEFINER AS
        $function$
        DECLARE
            __current_tag electric.tag;
            modified_mask boolean[];
        BEGIN
            RAISE DEBUG 'Trigger %% executed by operation %% at depth %% (tx %%)', TG_NAME, TG_OP, pg_trigger_depth(), pg_current_xact_id();
            RAISE DEBUG '  Given OLD %%', to_json(OLD);
            RAISE DEBUG '  Given NEW %%', to_json(NEW);
            __current_tag := (CURRENT_TIMESTAMP(3), NULL);

            -- USES COLUMN LIST
            INSERT INTO electric.%2$I (_last_modified, _tag, _tags, _resolved,
                                                    %4$s)
                VALUES (pg_current_xact_id()::text::bigint, __current_tag, ARRAY[__current_tag], false,
                        %5$s)
                ON CONFLICT (%6$s) DO UPDATE
                    SET _last_modified = pg_current_xact_id()::text::bigint,
                        _tag = __current_tag,
                        _is_a_delete_operation = false,
                        _resolved = false%7$s
                    -- We're only taking the timestamp here, since we want to override any Satellite writes,
                    -- and we order `NULL` source as larger than any other, so we're keeping that
                    RETURNING (GREATEST(%8$s)).timestamp INTO __current_tag.timestamp;

            RAISE DEBUG '  Storing max tag %%', __current_tag;
            PERFORM set_config('electric.current_transaction_max_tag', __current_tag::text, true);

            RETURN NEW;
        END;
        $function$;$injected$,
    function_name,
    shadow_table_name,
    tombstone_table_name,
    insertion_identifiers,
    insert_values,
    electric.format_every_and_join(primary_key_list, '%I'),
    modified_columns_bitmask_merger,
    electric.append_string_unless_empty('_tag', electric.format_every_and_join(tag_column_list, '%I')));

    RETURN function_name;
END;
$outer_function$;


CREATE OR REPLACE FUNCTION electric.install_function__update_shadow_row_from_delete(schema_name TEXT, table_name TEXT, primary_key_list TEXT[], non_pk_column_list TEXT[])
    RETURNS TEXT
    LANGUAGE PLPGSQL AS $outer_function$
DECLARE
    function_name TEXT := 'update_shadow_row_from_delete___' || schema_name || '__' || table_name;
    shadow_table_name TEXT := 'shadow__' || schema_name || '__' || table_name;
    tombstone_table_name TEXT := 'tombstone__' || schema_name || '__' || table_name;
    tag_column_list TEXT[] := electric.format_every(non_pk_column_list, '_tag_%s');
    primary_key_where_clause TEXT;
BEGIN
    primary_key_where_clause := electric.format_every_and_join(primary_key_list, '%1$I = OLD.%1$I', ' AND ');
    -- The `%n$I` placeholders use n-th argument for formatting.
    -- Generally, 1 is a function name, 2 is a shadow table name, 3 is a tombstone table name
    EXECUTE format($injected$
        CREATE OR REPLACE FUNCTION electric.%1$I()
            RETURNS TRIGGER
            LANGUAGE PLPGSQL SECURITY DEFINER AS
        $function$
        DECLARE
            __current_tag electric.tag;
        BEGIN
            RAISE DEBUG 'Trigger %% executed by operation %% at depth %% (tx %%)', TG_NAME, TG_OP, pg_trigger_depth(), pg_current_xact_id();
            RAISE DEBUG '  Given OLD %%', to_json(OLD);
            __current_tag := (CURRENT_TIMESTAMP(3), NULL);

            -- USES COLUMN LIST
            UPDATE electric.%2$I
                SET _last_modified = pg_current_xact_id()::text::bigint,
                    _tag = __current_tag,
                    _is_a_delete_operation = true,
                    _resolved = false
                WHERE %4$s
                RETURNING GREATEST(%5$s) INTO __current_tag;

            PERFORM set_config('electric.current_transaction_max_tag', __current_tag::text, true);

            RETURN OLD;
        END;
        $function$;$injected$,
    function_name,
    shadow_table_name,
    tombstone_table_name,
    primary_key_where_clause,
    electric.append_string_unless_empty('_tag', electric.format_every_and_join(tag_column_list, '%I'))
    );

    RETURN function_name;
END;
$outer_function$;


CREATE OR REPLACE FUNCTION electric.install_function__write_correct_max_tag(schema_name TEXT, table_name TEXT, primary_key_list TEXT[], non_pk_column_list TEXT[])
    RETURNS TEXT
    LANGUAGE PLPGSQL AS $outer_function$
DECLARE
    function_name TEXT := 'write_correct_max_tag___' || schema_name || '__' || table_name;
    shadow_table_name TEXT := 'shadow__' || schema_name || '__' || table_name;
    tombstone_table_name TEXT := 'tombstone__' || schema_name || '__' || table_name;
    tag_column_list TEXT[] := electric.format_every(non_pk_column_list, '_tag_%s');
    columns_to_write_blocks TEXT;
    where_pk_substitution TEXT;
    next_substitution_position_after_pk INTEGER;
    using_new_pk TEXT;
    where_pk_clause TEXT;
BEGIN
    next_substitution_position_after_pk := array_length(primary_key_list, 1) + 1;
    columns_to_write_blocks := electric.format_every_and_join(
        tag_column_list,
        format($$
                IF NEW._modified_columns_bit_mask[%%2$s] THEN
                columns_to_write := array_append(columns_to_write, '%%1$I = $%s');
                END IF;$$, next_substitution_position_after_pk),
        '');

    where_pk_substitution := electric.format_every_and_join(primary_key_list, '%I = $%s', ' AND ');
    using_new_pk := electric.format_every_and_join(primary_key_list, 'NEW.%I');
    where_pk_clause := electric.format_every_and_join(primary_key_list, '%1$I = NEW.%1$I', ' AND ');

    -- The `%n$I` placeholders use n-th argument for formatting.
    -- Generally, 1 is a function name, 2 is a shadow table name, 3 is a tombstone table name
    EXECUTE format($injected$
        CREATE OR REPLACE FUNCTION electric.%1$I()
            RETURNS TRIGGER
            LANGUAGE PLPGSQL SECURITY DEFINER AS
        $function$
        DECLARE
            -- This will throw an error if this setting is missing -- that would be an unexpected situation, so an error is appropriate
            max_tag electric.tag;
            columns_to_write text[] := array[]::text[];
        BEGIN
            RAISE DEBUG 'Trigger %% executed by operation %% at depth %% (tx %%)', TG_NAME, TG_OP, pg_trigger_depth(), pg_current_xact_id();
            max_tag := current_setting('electric.current_transaction_max_tag')::electric.tag;
            RAISE DEBUG '  In particular, with bitmask %% and max tag %%', NEW._modified_columns_bit_mask, max_tag;

            IF NEW._is_a_delete_operation THEN
                RAISE DEBUG '  Handling as DELETE operation';
                UPDATE electric.%2$I
                    SET _tag = max_tag, _tags = array[]::electric.tag[], _resolved = true
                    WHERE %8$s;
            ELSE
                RAISE DEBUG '  Handling as UPSERT operation';
                -- REPEATED BLOCK PER COLUMN
                %4$s

                EXECUTE format(
                    E'UPDATE electric.%2$I\n'
                    '   SET _tag = $%5$s, _tags = ARRAY[$%5$s], _resolved = true, _modified_columns_bit_mask = array[]::boolean[]%%s\n'
                    '   WHERE %6$s',
                    CASE WHEN array_length(columns_to_write, 1) IS NULL
                        THEN ''
                        ELSE ', ' || array_to_string(columns_to_write, ', ')
                    END
                ) USING %7$s, max_tag;
            END IF;

            RETURN NULL;
        END;
        $function$;$injected$,
    function_name,
    shadow_table_name,
    tombstone_table_name,
    columns_to_write_blocks,
    next_substitution_position_after_pk,
    where_pk_substitution,
    using_new_pk,
    where_pk_clause);

    RETURN function_name;
END;
$outer_function$;


/*
 * SATELLITE TRIGGER FUNCTIONS
 */
CREATE OR REPLACE FUNCTION electric.install_function__reorder_main_op(schema_name TEXT, table_name TEXT, primary_key_list TEXT[], non_pk_column_list TEXT[])
    RETURNS TEXT
    LANGUAGE PLPGSQL AS $outer_function$
DECLARE
    function_name TEXT := 'reorder_main_op___' || schema_name || '__' || table_name;
    shadow_table_name TEXT := 'shadow__' || schema_name || '__' || table_name;
    tombstone_table_name TEXT := 'tombstone__' || schema_name || '__' || table_name;
    reordered_column_list TEXT[];
    reordered_column_insert TEXT;
    insert_values TEXT;
    reordered_column_update TEXT := '';
BEGIN
    reordered_column_list := electric.format_every(non_pk_column_list, '__reordered_%s');
    reordered_column_insert := electric.format_every_and_join(reordered_column_list, '%I');
    insert_values := electric.format_every_and_join(primary_key_list || non_pk_column_list, 'NEW.%I');

    -- __reordered_col1 = NEW.col1, ...
    reordered_column_update := electric.zip_format_every_and_join(reordered_column_list, non_pk_column_list, '%I = NEW.%I');

    -- The `%n$I` placeholders use n-th argument for formatting.
    -- Generally, 1 is a function name, 2 is a shadow table name, 3 is a tombstone table name
    EXECUTE format($injected$
        CREATE OR REPLACE FUNCTION electric.%1$I()
            RETURNS TRIGGER
            LANGUAGE PLPGSQL SECURITY DEFINER AS
        $function$
        DECLARE
            _shadow_row_tmp electric.%2$I%%ROWTYPE;
        BEGIN
            RAISE DEBUG 'Trigger %% executed by operation %% at depth %% (tx %%)', TG_NAME, TG_OP, pg_trigger_depth(), pg_current_xact_id();

            -- We have received an INSERT (or an UPDATE, in development) that comes before the
            -- shadow table change (this is to reorder locking within the transaction). We need
            -- to save those values without performing an UPSERT to the main table yet

            -- USES COLUMN LIST
            INSERT INTO electric.%2$I (_currently_reordering, %5$s)
                VALUES (true, %6$s)
                ON CONFLICT (%4$s) DO UPDATE SET
                    %7$s
                RETURNING * INTO _shadow_row_tmp;

            RAISE DEBUG '  Resulting in a shadow row state %%', to_json(_shadow_row_tmp);
            
            RETURN NULL;
        END;
        $function$;$injected$,
    function_name,
    shadow_table_name,
    tombstone_table_name,
    electric.format_every_and_join(primary_key_list, '%I'),
    electric.format_every_and_join(primary_key_list || reordered_column_list, '%I'),
    insert_values,
    electric.append_string_unless_empty('_currently_reordering = true', reordered_column_update));

    RETURN function_name;
END;
$outer_function$;


CREATE OR REPLACE FUNCTION electric.install_function__shadow_insert_to_upsert(schema_name TEXT, table_name TEXT, primary_key_list TEXT[], non_pk_column_list TEXT[])
    RETURNS TEXT
    LANGUAGE PLPGSQL AS $outer_function$
DECLARE
    function_name TEXT := 'shadow_insert_to_upsert___' || schema_name || '__' || table_name;
    shadow_table_name TEXT := 'shadow__' || schema_name || '__' || table_name;
    tombstone_table_name TEXT := 'tombstone__' || schema_name || '__' || table_name;
    tag_column_list TEXT[] := electric.format_every(non_pk_column_list, '_tag_%s');
BEGIN
    -- The `%n$I` placeholders use n-th argument for formatting.
    -- Generally, 1 is a function name, 2 is a shadow table name, 3 is a tombstone table name
    EXECUTE format($injected$
        CREATE OR REPLACE FUNCTION electric.%1$I()
            RETURNS TRIGGER
            LANGUAGE PLPGSQL SECURITY DEFINER AS
        $function$
        BEGIN
            RAISE DEBUG 'Trigger %% executed by operation %% at depth %% (tx %%)', TG_NAME, TG_OP, pg_trigger_depth(), pg_current_xact_id();
            RAISE DEBUG '  Insert for shadow row %%', to_json(NEW);

            -- USES COLUMN LIST
            INSERT INTO electric.%2$I (_last_modified, _tag, _tags, %4$s)
                VALUES (pg_current_xact_id()::text::bigint, NEW._tag, ARRAY[NEW._tag], %5$s)
                ON CONFLICT (%6$s) DO UPDATE
                    SET _currently_reordering = NULL,
                        _last_modified = pg_current_xact_id()::text::bigint,
                        _tag = NEW._tag,
                        _is_a_delete_operation = NEW._is_a_delete_operation,
                        _observed_tags = NEW._observed_tags,
                        _modified_columns_bit_mask = NEW._modified_columns_bit_mask;

            RETURN NULL;
        END;
        $function$;$injected$,
    function_name,
    shadow_table_name,
    tombstone_table_name,
    electric.format_every_and_join(primary_key_list || tag_column_list, '%I'),
    electric.append_string_unless_empty(
        electric.format_every_and_join(primary_key_list, 'NEW.%I'),
        electric.format_every_and_join(tag_column_list, 'NEW._tag')
    ),
    electric.format_every_and_join(primary_key_list, '%I'));

    RETURN function_name;
END;
$outer_function$;


CREATE OR REPLACE FUNCTION electric.install_function__resolve_observed_tags(schema_name TEXT, table_name TEXT, primary_key_list TEXT[], non_pk_column_list TEXT[])
    RETURNS TEXT
    LANGUAGE PLPGSQL AS $outer_function$
DECLARE
    function_name TEXT := 'resolve_observed_tags___' || schema_name || '__' || table_name;
    shadow_table_name TEXT := 'shadow__' || schema_name || '__' || table_name;
    tombstone_table_name TEXT := 'tombstone__' || schema_name || '__' || table_name;
    reordered_insert_function_name TEXT := 'perform_reordered_op___' || schema_name || '__' || table_name;
    tag_column_list TEXT[] := electric.format_every(non_pk_column_list, '_tag_%s');
    reordered_column_list TEXT[];
    tag_resolution_blocks TEXT;
    reordered_column_save TEXT;
    reordered_column_reset TEXT;
BEGIN
    reordered_column_list := electric.format_every(non_pk_column_list, '__reordered_%s');
    tag_resolution_blocks := electric.format_every_and_join(
        tag_column_list,
        $$
            IF NEW._is_a_delete_operation OR NEW._tag < OLD.%1$I OR NOT NEW._modified_columns_bit_mask[%2$s] THEN
                NEW.%1$I = OLD.%1$I;
            ELSE
                NEW.%1$I = NEW._tag;
            END IF;
        $$, E'\n');

    reordered_column_save := electric.format_every_and_join(reordered_column_list, E'\n            NEW.%1$I = OLD.%1$I;', '');

    reordered_column_reset := electric.format_every_and_join(reordered_column_list, E'\n            NEW.%1$I = null;', '');

    -- The `%n$I` placeholders use n-th argument for formatting.
    -- Generally, 1 is a function name, 2 is a shadow table name, 3 is a tombstone table name
    EXECUTE format($injected$
        CREATE OR REPLACE FUNCTION electric.%1$I()
            RETURNS TRIGGER
            LANGUAGE PLPGSQL SECURITY DEFINER AS
        $function$
        BEGIN
            RAISE DEBUG 'Trigger %% executed by operation %% at depth %% (tx %%)', TG_NAME, TG_OP, pg_trigger_depth(), pg_current_xact_id();
            RAISE DEBUG '  Handling for shadow row %%', to_json(NEW);

            -- Remove observed tags from the tag set
            SELECT INTO NEW._tags ARRAY(SELECT unnest(OLD._tags) except SELECT unnest(NEW._observed_tags));    
            NEW._observed_tags = NULL;

            -- Append tags for UPSERT operations
            IF NEW._is_a_delete_operation IS DISTINCT FROM TRUE THEN
                NEW._tags = array_append(NEW._tags, NEW._tag);
            END IF;

            -- If operation is a DELETE, or the column on the OLD row is newer than the current insert, or if UPDATE didn't mark the column as modified
            --   Then we use `OLD.%%column%%`, since those updates are coming from Electric and `NEW` row values may be incorrect if they weren't modified
            -- Else, we use the value from the UPDATE

            -- REPEATED BLOCK PER COLUMN
            %4$s

            -- REPEATED BLOCK PER COLUMN    
            %5$s

            PERFORM electric.%7$I(NEW);

            -- REPEATED BLOCK PER COLUMN
            NEW._currently_reordering = null;
            %6$s

            RETURN NEW;
        END;
        $function$;$injected$,
    function_name,
    shadow_table_name,
    tombstone_table_name,
    tag_resolution_blocks,
    reordered_column_save,
    reordered_column_reset,
    reordered_insert_function_name);

    RETURN function_name;
END;
$outer_function$;

CREATE OR REPLACE FUNCTION electric.install_conflict_resolution_functions(schema_name TEXT, table_name TEXT, primary_key_list TEXT[], non_pk_column_list TEXT[])
    RETURNS JSONB
    LANGUAGE PLPGSQL AS $function$
DECLARE
    function_names JSONB := '{}'::jsonb;
BEGIN
    function_names := jsonb_set(function_names, '{perform_reordered_op}', to_jsonb(electric.install_function__perform_reordered_op(schema_name, table_name, primary_key_list, non_pk_column_list)));
    function_names := jsonb_set(function_names, '{generate_tombstone_entry}', to_jsonb(electric.install_function__generate_tombstone_entry(schema_name, table_name, primary_key_list, non_pk_column_list)));
    function_names := jsonb_set(function_names, '{create_shadow_row_from_upsert}', to_jsonb(electric.install_function__create_shadow_row_from_upsert(schema_name, table_name, primary_key_list, non_pk_column_list)));
    function_names := jsonb_set(function_names, '{update_shadow_row_from_delete}', to_jsonb(electric.install_function__update_shadow_row_from_delete(schema_name, table_name, primary_key_list, non_pk_column_list)));
    function_names := jsonb_set(function_names, '{write_correct_max_tag}', to_jsonb(electric.install_function__write_correct_max_tag(schema_name, table_name, primary_key_list, non_pk_column_list)));
    function_names := jsonb_set(function_names, '{reorder_main_op}', to_jsonb(electric.install_function__reorder_main_op(schema_name, table_name, primary_key_list, non_pk_column_list)));
    function_names := jsonb_set(function_names, '{shadow_insert_to_upsert}', to_jsonb(electric.install_function__shadow_insert_to_upsert(schema_name, table_name, primary_key_list, non_pk_column_list)));
    function_names := jsonb_set(function_names, '{resolve_observed_tags}', to_jsonb(electric.install_function__resolve_observed_tags(schema_name, table_name, primary_key_list, non_pk_column_list)));

    RETURN function_names;
END
$function$;
