/*
ElectricDB Migration
{"metadata": {"title": "create_compensation_test_tables", "name": "1664727242_create_compensation_test_tables", "sha256": "fda9c8a1f86d0c67eec25b1b111c601ee505c1b9eafc32069ce40de4a2d83506"}}
*/

CREATE TABLE IF NOT EXISTS main.parent (
  id INTEGER PRIMARY KEY,
  value TEXT,
  otherValue INTEGER DEFAULT 0
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS main.child (
  id INTEGER PRIMARY KEY,
  parent INTEGER NOT NULL,
  FOREIGN KEY(parent) REFERENCES parent(id)
) STRICT, WITHOUT ROWID;

/*---------------------------------------------
Below are templated triggers added by Satellite
---------------------------------------------*/


-- These are toggles for turning the triggers on and off
DROP TABLE IF EXISTS _electric_trigger_settings;
CREATE TABLE _electric_trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);
INSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.child', 1);
INSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.items', 1);
INSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.parent', 1);


/* Triggers for table child */

-- Ensures primary key is immutable
DROP TRIGGER IF EXISTS update_ensure_main_child_primarykey;
CREATE TRIGGER update_ensure_main_child_primarykey
   BEFORE UPDATE ON main.child
BEGIN
  SELECT
    CASE
      WHEN old.id != new.id THEN
        RAISE (ABORT,'cannot change the value of column id as it belongs to the primary key')
    END;
END;

-- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table

DROP TRIGGER IF EXISTS insert_main_child_into_oplog;
CREATE TRIGGER insert_main_child_into_oplog
   AFTER INSERT ON main.child
   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.child')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'child', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'parent', new.parent), NULL, NULL);
END;

DROP TRIGGER IF EXISTS update_main_child_into_oplog;
CREATE TRIGGER update_main_child_into_oplog
   AFTER UPDATE ON main.child
   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.child')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'child', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'parent', new.parent), json_object('id', old.id, 'parent', old.parent), NULL);
END;

DROP TRIGGER IF EXISTS delete_main_child_into_oplog;
CREATE TRIGGER delete_main_child_into_oplog
   AFTER DELETE ON main.child
   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.child')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'child', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'parent', old.parent), NULL);
END;

-- Triggers for foreign key compensations

DROP TRIGGER IF EXISTS compensation_insert_main_child_parent_into_oplog;
CREATE TRIGGER compensation_insert_main_child_parent_into_oplog
   AFTER INSERT ON main.child
   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.parent') AND
        1 == (SELECT value from _electric_meta WHERE key == 'compensations')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  SELECT 'main', 'parent', 'UPDATE', json_object('id', id), json_object('id', id, 'value', value, 'otherValue', otherValue), NULL, NULL
  FROM main.parent WHERE id = new.parent;
END;

DROP TRIGGER IF EXISTS compensation_update_main_child_parent_into_oplog;
CREATE TRIGGER compensation_update_main_child_parent_into_oplog
   AFTER UPDATE ON main.child
   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.parent') AND
        1 == (SELECT value from _electric_meta WHERE key == 'compensations')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  SELECT 'main', 'parent', 'UPDATE', json_object('id', id), json_object('id', id, 'value', value, 'otherValue', otherValue), NULL, NULL
  FROM main.parent WHERE id = new.parent;
END;


/* Triggers for table items */

-- Ensures primary key is immutable
DROP TRIGGER IF EXISTS update_ensure_main_items_primarykey;
CREATE TRIGGER update_ensure_main_items_primarykey
   BEFORE UPDATE ON main.items
BEGIN
  SELECT
    CASE
      WHEN old.value != new.value THEN
        RAISE (ABORT,'cannot change the value of column value as it belongs to the primary key')
    END;
END;

-- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table

DROP TRIGGER IF EXISTS insert_main_items_into_oplog;
CREATE TRIGGER insert_main_items_into_oplog
   AFTER INSERT ON main.items
   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'items', 'INSERT', json_object('value', new.value), json_object('value', new.value), NULL, NULL);
END;

DROP TRIGGER IF EXISTS update_main_items_into_oplog;
CREATE TRIGGER update_main_items_into_oplog
   AFTER UPDATE ON main.items
   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'items', 'UPDATE', json_object('value', new.value), json_object('value', new.value), json_object('value', old.value), NULL);
END;

DROP TRIGGER IF EXISTS delete_main_items_into_oplog;
CREATE TRIGGER delete_main_items_into_oplog
   AFTER DELETE ON main.items
   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'items', 'DELETE', json_object('value', old.value), NULL, json_object('value', old.value), NULL);
END;




/* Triggers for table parent */

-- Ensures primary key is immutable
DROP TRIGGER IF EXISTS update_ensure_main_parent_primarykey;
CREATE TRIGGER update_ensure_main_parent_primarykey
   BEFORE UPDATE ON main.parent
BEGIN
  SELECT
    CASE
      WHEN old.id != new.id THEN
        RAISE (ABORT,'cannot change the value of column id as it belongs to the primary key')
    END;
END;

-- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table

DROP TRIGGER IF EXISTS insert_main_parent_into_oplog;
CREATE TRIGGER insert_main_parent_into_oplog
   AFTER INSERT ON main.parent
   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.parent')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'parent', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'value', new.value, 'otherValue', new.otherValue), NULL, NULL);
END;

DROP TRIGGER IF EXISTS update_main_parent_into_oplog;
CREATE TRIGGER update_main_parent_into_oplog
   AFTER UPDATE ON main.parent
   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.parent')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'parent', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'value', new.value, 'otherValue', new.otherValue), json_object('id', old.id, 'value', old.value, 'otherValue', old.otherValue), NULL);
END;

DROP TRIGGER IF EXISTS delete_main_parent_into_oplog;
CREATE TRIGGER delete_main_parent_into_oplog
   AFTER DELETE ON main.parent
   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.parent')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'parent', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'value', old.value, 'otherValue', old.otherValue), NULL);
END;




