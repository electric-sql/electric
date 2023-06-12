-- vim: set shiftwidth=4:tabstop=4
--
-- you can call electrify using one of these variants:
--
-- 1. `CALL electric.electrify('my_table')`
-- 2. `CALL electric.electrify('my_schema', 'my_table')`
-- 3. `CALL electric.electrify('my_schema.my_table')`
--
-- the first two formats also support special characters in the table/schema name:
--
-- 4. `CALL electric.electrify('My Schema', 'My Table')`

CREATE OR REPLACE FUNCTION <%= schema %>.__pg_version() RETURNS integer AS $function$
    SELECT setting::int FROM pg_settings WHERE name = 'server_version_num'
$function$ LANGUAGE SQL;

-------------------------------------------------

CREATE OR REPLACE FUNCTION <%= schema %>.__table_schema(table_oid oid) RETURNS name AS $function$
DECLARE
   _schema name;
BEGIN
    SELECT pn.nspname INTO _schema
        FROM pg_class pc
        INNER JOIN pg_namespace pn ON pc.relnamespace = pn.oid
        WHERE pc.oid = table_oid;
    RETURN _schema;
END;
$function$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION <%= schema %>.capture_ddl(query text DEFAULT NULL) RETURNS int8 AS $function$
DECLARE
    _txid xid8;
    _txts timestamptz;
    _version text;
    _trid int8;
BEGIN
    SELECT v.txid, v.txts, v.version
        INTO _txid, _txts, _version
        FROM <%= schema %>.current_migration_version() v;

    _trid := (SELECT <%= schema %>.create_active_migration(_txid, _txts, _version, query));

    RETURN _trid;
END;
$function$ LANGUAGE PLPGSQL;

-------------------------------------------------

CREATE OR REPLACE PROCEDURE <%= schema %>.electrify(
    name1 text,
    name2 text DEFAULT NULL
) AS $function$
DECLARE
    _schema name;
    _table text;
    _quoted_name text;
    _ident text[];
    _oid regclass;
    _create_sql text;
BEGIN
    IF name1 IS NULL AND name2 IS NULL THEN
        RAISE EXCEPTION 'no valid table name given';
    ELSIF name2 IS NULL THEN
        -- handle table passed as 'schema.table'
        IF strpos(name1, '.') > 0 THEN
            _ident := parse_ident(name1);
            IF array_length(_ident, 1) = 1 THEN
                _table := _ident[1];
                _oid := (SELECT quote_ident(_table)::regclass);
                _schema := <%= schema %>.__table_schema(_oid);
            ELSIF array_length(_ident, 1) = 2 THEN
                _schema := _ident[1];
                _table := _ident[2];
            ELSE
                RAISE EXCEPTION 'invalid table name given %', name1;
            END IF;
        ELSE
            _table := name1;
            _oid := (SELECT quote_ident(_table)::regclass);
            _schema := <%= schema %>.__table_schema(_oid);
        END IF;
    ELSIF name1 IS NOT NULL AND name2 IS NOT NULL THEN
        _table := name2;
        _schema := name1;
    ELSE
        RAISE EXCEPTION 'no valid table name given';
    END IF;

    _quoted_name := format('%I.%I', _schema, _table);
    _oid := (SELECT _quoted_name::regclass);

    RAISE NOTICE 'Electrify table %', _quoted_name;

    IF NOT EXISTS (SELECT pc.oid FROM pg_class pc WHERE pc.oid = _oid AND pc.relkind = 'r') THEN
        RAISE EXCEPTION '% is not an ordinary table', _quoted_name;
    END IF;

    EXECUTE format('ALTER TABLE %I.%I REPLICA IDENTITY FULL;', _schema, _table);

    IF NOT EXISTS (
        SELECT pr.oid FROM pg_publication_rel pr
        INNER JOIN pg_publication pp ON pr.prpubid = pp.oid
        WHERE pp.pubname = '<%= publication_name %>'
        AND pr.prrelid = _oid
        ) THEN
        EXECUTE format('<%= publication_sql %>;', _schema, _table);
    ELSE
        RAISE WARNING 'table %.% is already electrified', _schema, _table;
    END IF;

    INSERT INTO <%= electrified_table %> (schema_name, table_name, oid)
        VALUES (_schema, _table, _oid) 
        ON CONFLICT ON CONSTRAINT unique_table_name
        DO NOTHING;

    -- insert the required ddl into the migrations table
    SELECT <%= schema %>.ddlx_create(_oid) INTO _create_sql; 

    RAISE DEBUG '%', _create_sql;

    PERFORM <%= schema %>.capture_ddl(_create_sql);
END;
$function$ LANGUAGE PLPGSQL;

-------------------------------------------------

CREATE OR REPLACE FUNCTION <%= schema %>.__table_is_electrified(classid oid, objid oid)
RETURNS boolean AS $function$
BEGIN
    RETURN EXISTS (SELECT id FROM <%= electrified_table %> WHERE oid = objid);
END;
$function$ LANGUAGE PLPGSQL;

-------------------------------------------------

CREATE OR REPLACE FUNCTION <%= schema %>.__create_index_is_electrified(classid oid, objid oid)
RETURNS int8 AS $function$
DECLARE 
    _eid int8;
BEGIN
    SELECT e.id INTO _eid FROM <%= electrified_table %> e
        INNER JOIN pg_index pi ON e.oid = pi.indrelid
        WHERE pi.indexrelid = objid;
    RETURN _eid;
END;
$function$ LANGUAGE PLPGSQL;

-------------------------------------------------

CREATE OR REPLACE FUNCTION <%= schema %>.ddlx_command_end_handler() 
RETURNS EVENT_TRIGGER AS $function$
DECLARE
    _trid int8;
    _cmd record;
    _capture bool := false;
    _table_id int8;
BEGIN
    RAISE DEBUG 'command_end_handler:: start';

    FOR _cmd IN SELECT * FROM pg_event_trigger_ddl_commands() 
    LOOP
            -- don't capture create table events, those are inserted by the electrify call
        CASE 
            WHEN _cmd.object_type = 'table' THEN
               _capture := _capture OR <%= schema %>.__table_is_electrified(_cmd.classid, _cmd.objid);
            WHEN _cmd.object_type = 'table column' THEN
                IF <%= schema %>.__table_is_electrified(_cmd.classid, _cmd.objid) THEN
                    RAISE EXCEPTION 'modifying column of electrified table %', _cmd.object_identity;
                END IF;
            WHEN _cmd.command_tag = 'CREATE INDEX' THEN
                _table_id := <%= schema %>.__create_index_is_electrified(_cmd.classid, _cmd.objid);
                IF _table_id THEN
                    -- capture the index id into a special electrified_index table
                    -- so that we can check if it's electrified when it's being dropped
                    -- without this, by the time we get the cmd in the event trigger the 
                    -- index has already been dropped and the lookups required no longer
                    -- exist
                    INSERT INTO <%= electrified_index %> (id, table_id) VALUES (_cmd.objid, _table_id);
                    _capture := true;
                END IF;
            ELSE NULL;
        END CASE;
    END LOOP;

    IF _capture THEN
        _trid := (SELECT <%= schema %>.capture_ddl());
        RAISE DEBUG 'create_active_migration = %', _trid;
    END IF;

    RAISE DEBUG 'command_end_handler:: end';
END;
$function$ LANGUAGE PLPGSQL;


CREATE OR REPLACE FUNCTION <%= schema %>.ddlx_sql_drop_handler() 
RETURNS EVENT_TRIGGER AS $function$
DECLARE
    _capture bool := false;
    _cmd record;
    _trid int8;
BEGIN
    FOR _cmd IN SELECT * FROM pg_event_trigger_dropped_objects() 
    LOOP
        RAISE DEBUG 'DROP // classid: %; objid: %; objsubid: %, object_type: %',
            _cmd.classid, _cmd.objid, _cmd.objsubid, _cmd.object_type; 
        CASE 
            WHEN _cmd.object_type = 'table' THEN
                IF <%= schema %>.__table_is_electrified(_cmd.classid, _cmd.objid) THEN
                    RAISE EXCEPTION 'dropping electrified table %', _cmd.object_identity;
                END IF;
            WHEN _cmd.object_type = 'table column' THEN
                IF <%= schema %>.__table_is_electrified(_cmd.classid, _cmd.objid) THEN
                    RAISE EXCEPTION 'dropping column electrified table %', _cmd.object_identity;
                END IF;
            WHEN _cmd.object_type = 'index' THEN 
                IF EXISTS (SELECT id FROM <%= electrified_index %> WHERE id = _cmd.objid) THEN
                    -- clean up the electrified index table
                    DELETE FROM <%= electrified_index %> WHERE id = _cmd.objid;
                    RAISE WARNING 'index is being dropped %', _capture;
                    _capture := true;
                END IF;
            ELSE NULL;
        END CASE;
    END LOOP;

    IF _capture THEN
        _trid := (SELECT <%= schema %>.capture_ddl());
    END IF;
END;
$function$ LANGUAGE PLPGSQL;
