-- noinspection SqlNoDataSourceInspectionForFile

-- CUT HERE create the schema
CREATE SCHEMA IF NOT EXISTS electric;

-- CUT HERE grants table
CREATE TABLE IF NOT EXISTS electric.grants (
    privilege VARCHAR(20) NOT NULL,
    on_table VARCHAR(64) NOT NULL,
    role VARCHAR(64) NOT NULL,
    column_name VARCHAR(64) NOT NULL,
    scope VARCHAR(64) NOT NULL,
    using_path TEXT,
    check_fn TEXT,
    CONSTRAINT grants_pkey PRIMARY KEY (privilege, on_table, role, scope, column_name));

-- CUT HERE roles table
CREATE TABLE IF NOT EXISTS electric.roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(64) NOT NULL,
    user_id VARCHAR(256) NOT NULL,
    scope_table VARCHAR(64),
    scope_id VARCHAR(256)
    );

-- CUT HERE assignments table
CREATE TABLE IF NOT EXISTS electric.assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(64) NOT NULL,
    scope_table VARCHAR(64) NOT NULL,
    user_column VARCHAR(64) NOT NULL,
    role_name VARCHAR(64) NOT NULL,
    role_column VARCHAR(64) NOT NULL,
    if_fn TEXT,
    CONSTRAINT unique_assign UNIQUE (table_name, scope_table, user_column, role_name, role_column));


-- CUT HERE enable function
CREATE OR REPLACE FUNCTION electric.enable(table_name text)
  RETURNS BOOLEAN AS $$
  BEGIN
    CALL electric.electrify(table_name);
    RETURN 1;
  END;
$$ LANGUAGE plpgsql;

-- CUT HERE disable function
CREATE OR REPLACE FUNCTION electric.disable(table_name text)
  RETURNS BOOLEAN AS $$
  BEGIN

    RETURN 1;
  END;

$$ LANGUAGE plpgsql;

-- CUT HERE grant function
CREATE OR REPLACE FUNCTION electric.grant(privilege_name text,
  on_table_name text,
  role_name text,
  columns text[],
  scope_name text,
  using_path text,
  check_fn text)
  RETURNS BOOLEAN AS $$

  DECLARE
    col TEXT;

  BEGIN
    FOREACH col IN ARRAY columns
    LOOP
      INSERT INTO electric.grants ( privilege, on_table, role , column_name, scope, using_path, check_fn)
      VALUES (privilege_name, on_table_name, role_name, col, scope_name, using_path, check_fn)
        ON CONFLICT ON CONSTRAINT grants_pkey DO UPDATE SET
        (using_path, check_fn) = (EXCLUDED.using_path, EXCLUDED.check_fn);
    END LOOP;

    RETURN 1;
  END;

$$ LANGUAGE plpgsql;

-- CUT HERE revoke function
CREATE OR REPLACE FUNCTION electric.revoke(privilege_name text,
  on_table_name text,
  role_name text,
  columns text[],
  scope_name text)
  RETURNS BOOLEAN AS $$

  DECLARE
    all_columns BOOLEAN;

  BEGIN
    PERFORM '*' = ANY(columns) As all_columns;

    IF all_columns THEN
      DELETE FROM electric.grants WHERE
          privilege = privilege_name AND
          on_table = on_table_name AND
          role = role_name AND
          scope = scope_name;
    ELSE
      DELETE FROM electric.grants WHERE
          privilege = privilege_name AND
          on_table = on_table_name AND
          role = role_name AND
          scope = scope_name AND
          column_name = any(columns);
    END IF;

    RETURN 1;
  END;

$$ LANGUAGE plpgsql;


-- CUT HERE assign function
CREATE OR REPLACE FUNCTION electric.assign(
    assign_schema text,
    assign_table text,
    scope text,
    user_column_name text,
    role_name_string text,
    role_column_name text,
    if_fn text
)
    RETURNS BOOLEAN AS $$

DECLARE
    assignment_id        uuid;
    assign_table_full_name     TEXT;
    scope_table_not_null TEXT;
    role_name_not_null   TEXT;
    role_column_not_null TEXT;
    if_fn_not_null       TEXT;
    role_def             TEXT;
    assignment_name      TEXT;
    user_column_type     TEXT;
    scope_key_count      int;
    user_key_count       int;
    scope_key            RECORD;
    user_key             RECORD;
    primary_key          RECORD;

BEGIN

    -- return types for the introspection of foreign keys
    CREATE TEMP TABLE scope_fkeys
    (
        from_schema  name,
        from_table   name,
        from_columns name[10],
        to_schema    name,
        to_table     name,
        to_columns   name[10],
        to_types     information_schema.character_data[10]
    );

    CREATE TEMP TABLE user_fkeys
    (
        from_schema  name,
        from_table   name,
        from_columns name[10],
        to_schema    name,
        to_table     name,
        to_columns   name[10],
        to_types     information_schema.character_data[10]
    );

    CREATE TEMP TABLE pkeys
    (
        columns     name[10],
        types       information_schema.character_data[10]
    );

    -- gets the columns and types for the assign_table's primary key
    INSERT INTO pkeys SELECT * from electric.find_pk(assign_schema, assign_table);
    SELECT * FROM pkeys LIMIT 1 INTO primary_key;


    -- gets the foreign key pointing to the user
    INSERT INTO user_fkeys SELECT * from electric.find_fk_for_column(assign_schema,assign_table, user_column_name);
    SELECT COUNT(*) FROM user_fkeys INTO user_key_count;

    IF user_key_count = 0 THEN
        DROP TABLE scope_fkeys;
        DROP TABLE user_fkeys;
        DROP TABLE pkeys;
        RAISE EXCEPTION 'Could not find a foreign key pointing to the user table';
    END IF;

    SELECT * FROM user_fkeys LIMIT 1 INTO user_key;

    SELECT data_type FROM information_schema.columns
        WHERE table_name = user_key.to_table and column_name = user_key.to_columns[1]
        INTO user_column_type;

    -- sets some things to default strings if the function args are null
    IF scope IS NULL THEN scope_table_not_null = '__none__'; ELSE scope_table_not_null = scope; END IF;
    IF if_fn IS NULL THEN if_fn_not_null = 'true'; ELSE if_fn_not_null = if_fn; END IF;

    IF role_name_string IS NULL AND role_column_name IS NULL THEN
        DROP TABLE scope_fkeys;
        DROP TABLE user_fkeys;
        DROP TABLE pkeys;
        RAISE EXCEPTION 'You must give either a role_name_string or a role_column_name';
    END IF;

    IF NOT role_name_string IS NULL AND NOT role_column_name IS NULL THEN
        DROP TABLE scope_fkeys;
        DROP TABLE user_fkeys;
        DROP TABLE pkeys;
        RAISE EXCEPTION 'You must give either a role_name_string or a role_column_name but not both';
    END IF;

    assign_table_full_name = format('%s.%s', assign_schema, assign_table);

    IF role_name_string IS NULL THEN
        role_name_not_null = '__none__';
        role_column_not_null = role_column_name;
        role_def = format('NEW.%s', role_column_name);
    ELSE
        role_name_not_null = role_name_string;
        role_column_not_null = '__none__';
        role_def = format(E'\'%s\'', role_name_string);
    END IF;

    -- reads the foreign key for the scope if it exists
    IF NOT scope IS NULL THEN
        INSERT INTO scope_fkeys SELECT * from electric.find_fk_to_table(assign_schema,assign_table, scope);
        SELECT COUNT(*) FROM scope_fkeys INTO scope_key_count;

        IF scope_key_count > 1 THEN
            DROP TABLE scope_fkeys;
            DROP TABLE user_fkeys;
            DROP TABLE pkeys;
            -- The assign_table is assumed to have a single foreign key pointing to the scope table
            RAISE EXCEPTION 'Too many foreign keys for the scope table';
        END IF;

        IF scope_key_count = 0 THEN
            DROP TABLE scope_fkeys;
            DROP TABLE user_fkeys;
            DROP TABLE pkeys;
            -- The assign_table is assumed to have a single foreign key pointing to the scope table
            RAISE EXCEPTION 'Could not find a foreign key pointing to the scope table';
        END IF;

        SELECT * FROM scope_fkeys LIMIT 1 INTO scope_key;

    END IF;

    -- Creates the assignment itself.
    INSERT INTO electric.assignments (table_name, scope_table, user_column, role_name, role_column, if_fn)
        VALUES (assign_table_full_name, scope_table_not_null, user_column_name, role_name_not_null, role_column_not_null, if_fn)
        RETURNING id INTO assignment_id;

    if assignment_id IS NULL THEN
        DROP TABLE scope_fkeys;
        DROP TABLE user_fkeys;
        DROP TABLE pkeys;
        RAISE EXCEPTION 'Could not create assignment';
    END IF;


    -- this is a canonical name used by components owned by this assignment
    assignment_name = REPLACE(format('%s', assignment_id), '-', '_');

    /*
     Creates big fat join table. Every time the assignment rule is used and a user is given a role a row will be created
     in both this join table and in the table electric.roles. This table serves as a polymorphic join between the roles
     table and the different types of both scope table and assignment table, and handles clean up correctly via fk cascade on delete.

     This table have 4 or 5 foreign keys

    It has foreign keys with ON DELETE CASCADE pointing to:
     - The assignment created above. This assignment is the rule that causes all the entries in this join to be created in owns them.
     - The user that the role has been given too.
     - The assignment table item that assigned the role.
     - The row in the scope table if one is specified.

     So that any of these being deleted will remove the join.

     And it has a foreign key pointing to the role in electric.roles which it will delete with a trigger.
     */

    EXECUTE format('CREATE TABLE IF NOT EXISTS electric.assignment_%s_join (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id %s,
        assignment_id uuid,
        role_id uuid,
        FOREIGN KEY(role_id)
            REFERENCES electric.roles(id),
        FOREIGN KEY(user_id)
            REFERENCES %s.%s(%s)
            ON DELETE CASCADE,
        FOREIGN KEY(assignment_id)
            REFERENCES electric.assignments(id)
            ON DELETE CASCADE
        );',
        assignment_name,
        user_key.to_types[1],
        user_key.to_schema,
        user_key.to_table,
        user_key.to_columns[1]
        );

    -- Adds a foreign key to the join table pointing to the assign_table
    for counter in 1..ARRAY_LENGTH(primary_key.columns, 1)
        loop
            EXECUTE format('ALTER TABLE electric.assignment_%s_join ADD COLUMN IF NOT EXISTS %s_%s %s;',
                           assignment_name,
                           assign_table,
                           primary_key.columns[counter],
                           primary_key.types[counter]
                );
        end loop;

    EXECUTE format('ALTER TABLE electric.assignment_%s_join
                    ADD CONSTRAINT electric_%s_join_%s_fk
                    FOREIGN KEY (%s_%s)
                    REFERENCES %s.%s(%s)
                    ON DELETE CASCADE;',
        assignment_name,
        assignment_name,
        assign_table,
        assign_table,
        ARRAY_TO_STRING(primary_key.columns, format(', %s_', assign_table)),
        assign_schema,
        assign_table,
        ARRAY_TO_STRING(primary_key.columns, ', ')
        );

    -- defines insert and update trigger functions for the assign_table
    -- when there is no scope
    IF scope IS NULL THEN

        EXECUTE format(E'CREATE OR REPLACE FUNCTION electric.upsert_role_%1$s() RETURNS TRIGGER
                        AS $%2$s$
                        DECLARE
                            role_key uuid;
                            join_key uuid;
                        BEGIN

                        SELECT id, role_id FROM electric.assignment_%1$s_join WHERE assignment_id = \'%4$s\' AND ( %5$s_%6$s ) = ( NEW.%7$s ) INTO join_key, role_key;
                        IF ( %8$s ) THEN
                           IF join_key IS NULL THEN
                               INSERT INTO electric.roles (user_id, role)
                                   VALUES (NEW.%9$s, %10$s) returning id INTO role_key;
                               INSERT INTO electric.assignment_%1$s_join (user_id, %5$s_%6$s, role_id, assignment_id)
                                   VALUES (NEW.%9$s, NEW.%7$s, role_key, \'%4$s\');
                           ELSE
                               UPDATE electric.assignment_%1$s_join SET user_id = NEW.%9$s
                                   WHERE id = join_key;
                               UPDATE electric.roles SET (user_id, role) = (NEW.%9$s, %10s)
                                   WHERE id = role_key;
                           END IF;
                        ELSE
                            IF NOT join_key IS NULL THEN
                                DELETE FROM electric.assignment_%1$s_join WHERE id = join_key;
                            END IF;
                        END IF;
                        RETURN NEW;
                        END;
                        $%2$s$ LANGUAGE plpgsql;',
            --1
            assignment_name,
            --2
            '',
            --3
            '',
            --4
            assignment_id,
            --5
            assign_table,
            --6
            ARRAY_TO_STRING(primary_key.columns, format(', %s_', assign_table)),
            --7
            ARRAY_TO_STRING(primary_key.columns, ', NEW.'),
            --8
            if_fn_not_null,
            --9
            user_key.from_columns[1],
            --10
            role_def,
            --11
            scope
        );

    -- and when there is a scope
    ELSE
        for counter in 1..ARRAY_LENGTH(scope_key.from_columns, 1)
            loop
                EXECUTE format('ALTER TABLE electric.assignment_%s_join ADD COLUMN IF NOT EXISTS %s %s;',
                               assignment_name,
                               scope_key.from_columns[counter],
                               scope_key.to_types[counter]
                    );
            end loop;

        EXECUTE format('ALTER TABLE electric.assignment_%s_join
                        ADD CONSTRAINT electric_%s_join_scope_fk
                        FOREIGN KEY (%s)
                        REFERENCES %s.%s(%s)
                        ON DELETE CASCADE;',
            assignment_name,
            assignment_name,
            ARRAY_TO_STRING(scope_key.from_columns, ', '),
            scope_key.to_schema,
            scope_key.to_table,
            ARRAY_TO_STRING(scope_key.to_columns, ', ')
            );

        EXECUTE format(E'CREATE OR REPLACE FUNCTION electric.upsert_role_%1$s() RETURNS TRIGGER
                        AS $%2$s$
                        DECLARE
                            scope_key TEXT;
                            scope_list TEXT[];
                            role_key uuid;
                            join_key uuid;
                        BEGIN

                        scope_list := ARRAY[NEW.%3$s::text];
                        scope_key := ARRAY_TO_STRING(scope_list, \', \' );

                        SELECT id, role_id FROM electric.assignment_%1$s_join WHERE assignment_id = \'%4$s\' AND ( %5$s_%6$s ) = ( NEW.%7$s ) INTO join_key, role_key;
                        IF ( %8$s ) THEN
                           IF join_key IS NULL THEN
                               INSERT INTO electric.roles (user_id, role, scope_table, scope_id)
                                   VALUES (NEW.%9$s, %10$s, \'%11$s\', scope_key) returning id INTO role_key;
                               INSERT INTO electric.assignment_%1$s_join (user_id, %12$s, %5$s_%6$s, role_id, assignment_id)
                                   VALUES (NEW.%9$s, NEW.%13$s, NEW.%7$s, role_key, \'%4$s\');
                           ELSE
                               UPDATE electric.assignment_%1$s_join SET (user_id, %12$s)
                                   = (NEW.%9$s, NEW.%13$s) WHERE id = join_key;
                               UPDATE electric.roles SET (user_id, role, scope_table, scope_id)
                                   = (NEW.%9$s, %10$s, \'%11$s\', scope_key) WHERE id = role_key;
                           END IF;
                        ELSE
                            IF NOT join_key IS NULL THEN
                                DELETE FROM electric.assignment_%1$s_join WHERE id = join_key;
                            END IF;
                        END IF;
                        RETURN NEW;
                        END;
                        $%2$s$ LANGUAGE plpgsql;',
            --1
            assignment_name,
            --2
            '',
            --3
            ARRAY_TO_STRING(scope_key.from_columns, '::text, NEW.'),
            --4
            assignment_id,
            --5
            assign_table,
            --6
            ARRAY_TO_STRING(primary_key.columns, format(', %s_', assign_table)),
            --7
            ARRAY_TO_STRING(primary_key.columns, ', NEW.'),
            --8
            if_fn_not_null,
            --9
            user_key.from_columns[1],
            --10
            role_def,
            --11
            scope,
            --12
            ARRAY_TO_STRING(scope_key.from_columns, ', '),
            --13
            ARRAY_TO_STRING(scope_key.from_columns, ', NEW.')
        );
    END IF;

    -- adds a trigger to the join table that deletes the role itself
    EXECUTE format(E'CREATE OR REPLACE FUNCTION  electric.cleanup_role_%s() RETURNS TRIGGER
                   AS $%s$
                   BEGIN
                      DELETE FROM electric.roles WHERE id = OLD.role_id;
                   RETURN OLD;
                   END;
                   $%s$ LANGUAGE plpgsql;',
        assignment_name,
        '',
        ''
        );

    EXECUTE format('CREATE OR REPLACE TRIGGER electric_cleanup_role_%s
                AFTER DELETE ON electric.assignment_%s_join
                FOR EACH ROW
                EXECUTE FUNCTION electric.cleanup_role_%s();',
        assignment_name,
        assignment_name,
        assignment_name
    );

    -- adds the insert and update triggers functions to the assign_table
    EXECUTE format('CREATE OR REPLACE TRIGGER electric_insert_role_%s
                AFTER INSERT ON %s
                FOR EACH ROW
                EXECUTE FUNCTION electric.upsert_role_%s();',
        assignment_name,
        assign_table,
        assignment_name
    );

    EXECUTE format('CREATE OR REPLACE TRIGGER electric_update_role_%s
                AFTER UPDATE ON %s
                FOR EACH ROW
                EXECUTE FUNCTION electric.upsert_role_%s();',
        assignment_name,
        assign_table,
        assignment_name
    );
    DROP TABLE scope_fkeys;
    DROP TABLE user_fkeys;
    DROP TABLE pkeys;
    return 1;

END;

$$ LANGUAGE plpgsql;


-- CUT HERE unassign function
CREATE OR REPLACE FUNCTION electric.unassign(assign_schema text,
                                             assign_table text,
                                             scope text,
                                             user_column_name text,
                                             role_name_string text,
                                             role_column_name text
)
    RETURNS BOOLEAN AS
$$

DECLARE
    assignment_id        uuid;
    assignment_name      TEXT;
    scope_table_not_null TEXT;
    role_name_not_null   TEXT;
    role_column_not_null TEXT;
    assign_table_full_name TEXT;

BEGIN

    IF role_name_string IS NULL THEN role_name_not_null = '__none__'; ELSE role_name_not_null = role_name_string; END IF;
    IF role_column_name IS NULL THEN role_column_not_null = '__none__'; ELSE role_column_not_null = role_column_name; END IF;
    IF scope IS NULL THEN scope_table_not_null = '__none__'; ELSE scope_table_not_null = scope; END IF;

    assign_table_full_name = format('%s.%s', assign_schema, assign_table);

    SELECT id FROM electric.assignments
        WHERE table_name = assign_table_full_name
        AND scope_table = scope_table_not_null
        AND user_column = user_column_name
        AND role_name = role_name_not_null
        AND role_column = role_column_not_null
        INTO assignment_id;

    assignment_name = REPLACE(format('%s', assignment_id), '-', '_');

    -- remove triggers
    EXECUTE format('DROP TRIGGER IF EXISTS electric_cleanup_role_%s ON electric.assignment_%s_join;',
        assignment_name,
        assignment_name
    );

    EXECUTE format('DROP TRIGGER IF EXISTS electric_insert_role_%s ON %s;',
        assignment_name,
        assign_table
    );

    EXECUTE format('DROP TRIGGER IF EXISTS electric_update_role_%s ON %s;',
        assignment_name,
        assign_table
    );

    -- remove functions
    EXECUTE format('DROP FUNCTION IF EXISTS electric.cleanup_role_%s;',
        assignment_name
    );

    EXECUTE format('DROP FUNCTION IF EXISTS electric.upsert_role_%s;',
        assignment_name
    );

    -- remove join table
    EXECUTE format('DROP TABLE IF EXISTS electric.assignment_%s_join;',
        assignment_name
    );

    -- remove assignment
    DELETE FROM electric.assignments WHERE id = assignment_id;

    return 1;

END;

$$ LANGUAGE plpgsql;

-- CUT HERE sqlite function
CREATE OR REPLACE FUNCTION electric.sqlite(sql text)
  RETURNS BOOLEAN AS $$

  BEGIN

    RETURN 1;
  END;

$$ LANGUAGE plpgsql;


-- CUT HERE find foreign keys
CREATE OR REPLACE FUNCTION electric.find_fk_to_table(
    src_schema text,
    src_table text,
    dst_table text) RETURNS TABLE(
        from_schema name,
        from_table name,
        from_columns name[10],
        to_schema name,
        to_table name,
        to_columns name[10],
        to_types information_schema.character_data[10]
        ) AS $$

    BEGIN
        RETURN QUERY
        SELECT sch.nspname                               AS "from_schema",
           tbl.relname                                   AS "from_table",
           ARRAY_AGG(col.attname ORDER BY u.attposition) AS "from_columns",
           f_sch.nspname                                 AS "to_schema",
           f_tbl.relname                                 AS "to_table",
           ARRAY_AGG(f_col.attname ORDER BY f_u.attposition) AS "to_columns",
           ARRAY_AGG((SELECT data_type FROM information_schema.columns WHERE table_name = src_table and column_name = col.attname) ORDER BY f_u.attposition) AS "to_types"
        FROM pg_constraint c
               LEFT JOIN LATERAL UNNEST(c.conkey) WITH ORDINALITY AS u(attnum, attposition) ON TRUE
               LEFT JOIN LATERAL UNNEST(c.confkey) WITH ORDINALITY AS f_u(attnum, attposition) ON f_u.attposition = u.attposition
               JOIN pg_class tbl ON tbl.oid = c.conrelid
               JOIN pg_namespace sch ON sch.oid = tbl.relnamespace
               LEFT JOIN pg_attribute col ON (col.attrelid = tbl.oid AND col.attnum = u.attnum)
               LEFT JOIN pg_class f_tbl ON f_tbl.oid = c.confrelid
               LEFT JOIN pg_namespace f_sch ON f_sch.oid = f_tbl.relnamespace
               LEFT JOIN pg_attribute f_col ON (f_col.attrelid = f_tbl.oid AND f_col.attnum = f_u.attnum)
        WHERE c.contype = 'f' and tbl.relname = src_table and f_tbl.relname = dst_table and sch.nspname = src_schema
        GROUP BY "from_schema", "from_table", "to_schema", "to_table"
        ORDER BY "from_schema", "from_table";
    END;

$$ LANGUAGE plpgsql;

-- CUT HERE find foreign keys for column
CREATE OR REPLACE FUNCTION electric.find_fk_for_column(
    src_schema text,
    src_table text,
    src_column text) RETURNS TABLE(
        from_schema name,
        from_table name,
        from_columns name[10],
        to_schema name,
        to_table name,
        to_columns name[10],
        to_types information_schema.character_data[10]
        ) AS $$

    BEGIN
        RETURN QUERY
        SELECT sch.nspname                               AS "from_schema",
           tbl.relname                                   AS "from_table",
           ARRAY_AGG(col.attname ORDER BY u.attposition) AS "from_columns",
           f_sch.nspname                                 AS "to_schema",
           f_tbl.relname                                 AS "to_table",
           ARRAY_AGG(f_col.attname ORDER BY f_u.attposition) AS "to_columns",
           ARRAY_AGG((SELECT data_type FROM information_schema.columns WHERE table_name = src_table and column_name = col.attname) ORDER BY f_u.attposition) AS "to_types"
        FROM pg_constraint c
               LEFT JOIN LATERAL UNNEST(c.conkey) WITH ORDINALITY AS u(attnum, attposition) ON TRUE
               LEFT JOIN LATERAL UNNEST(c.confkey) WITH ORDINALITY AS f_u(attnum, attposition) ON f_u.attposition = u.attposition
               JOIN pg_class tbl ON tbl.oid = c.conrelid
               JOIN pg_namespace sch ON sch.oid = tbl.relnamespace
               LEFT JOIN pg_attribute col ON (col.attrelid = tbl.oid AND col.attnum = u.attnum)
               LEFT JOIN pg_class f_tbl ON f_tbl.oid = c.confrelid
               LEFT JOIN pg_namespace f_sch ON f_sch.oid = f_tbl.relnamespace
               LEFT JOIN pg_attribute f_col ON (f_col.attrelid = f_tbl.oid AND f_col.attnum = f_u.attnum)
        WHERE c.contype = 'f' and tbl.relname = src_table and col.attname = src_column and sch.nspname = src_schema
        GROUP BY "from_schema", "from_table", "to_schema", "to_table"
        ORDER BY "from_schema", "from_table";
    END;

$$ LANGUAGE plpgsql;

-- CUT HERE find primary key
CREATE OR REPLACE FUNCTION electric.find_pk(
    src_schema text,
    src_table text) RETURNS TABLE(
        columns name[10],
        types information_schema.character_data[10]
        ) AS $$
    BEGIN
        RETURN QUERY
        SELECT ARRAY_AGG(col.attname ORDER BY u.attposition) AS "columns",
           ARRAY_AGG((SELECT data_type FROM information_schema.columns WHERE table_name = src_table and column_name = col.attname) ORDER BY f_u.attposition) AS "types"
        FROM pg_constraint c
               LEFT JOIN LATERAL UNNEST(c.conkey) WITH ORDINALITY AS u(attnum, attposition) ON TRUE
               LEFT JOIN LATERAL UNNEST(c.confkey) WITH ORDINALITY AS f_u(attnum, attposition) ON f_u.attposition = u.attposition
               JOIN pg_class tbl ON tbl.oid = c.conrelid
               JOIN pg_namespace sch ON sch.oid = tbl.relnamespace
               LEFT JOIN pg_attribute col ON (col.attrelid = tbl.oid AND col.attnum = u.attnum)
               LEFT JOIN pg_class f_tbl ON f_tbl.oid = c.confrelid
               LEFT JOIN pg_namespace f_sch ON f_sch.oid = f_tbl.relnamespace
               LEFT JOIN pg_attribute f_col ON (f_col.attrelid = f_tbl.oid AND f_col.attnum = f_u.attnum)
        WHERE c.contype = 'p' and tbl.relname = src_table and sch.nspname = src_schema;
    END;

$$ LANGUAGE plpgsql;
