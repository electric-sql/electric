/*
Initial migration for Satellite with compensations

- Table for storing key-value pairs for storing Satellite metadata
- Table for enabling/disabling triggers per table
- Triggers INSERT, UPDATE, DELETE per-table to record operation in the oplog
- Trigger per-table to prevent updates to primary key
- Trigger for INSERT and UPDATE and per-column(s) that is a FOREIGN KEY
*/

CREATE TABLE IF NOT EXISTS main.parent (
  id INTEGER PRIMARY KEY,
  value TEXT,
  otherValue INTEGER DEFAULT 0
) STRICT;

CREATE TABLE IF NOT EXISTS main.child (
  id INTEGER PRIMARY KEY,
  parent INTEGER NOT NULL,
  FOREIGN KEY(parent) REFERENCES parent(id)
) STRICT;

CREATE TABLE IF NOT EXISTS main._electric_oplog (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace String NOT NULL,
  tablename String NOT NULL,
  optype String NOT NULL,
  primaryKey String NOT NULL,
  newRow String,
  oldRow String,
  timestamp TEXT
);

CREATE TABLE IF NOT EXISTS main._electric_meta (
  key TEXT,
  value TEXT
);

INSERT INTO _electric_meta(key,value) VALUES ('currRowId', '-1'), ('ackRowId','-1'), ('compensations', 0);

DROP TABLE IF EXISTS trigger_settings;
CREATE TABLE trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);

INSERT INTO trigger_settings(tablename,flag) VALUES ('main.parent', 1);

DROP TRIGGER IF EXISTS update_ensure_parent_primarykey;
CREATE TRIGGER update_ensure_parent_primarykey
   BEFORE UPDATE ON main.parent
BEGIN
  SELECT
    CASE
      WHEN old.id != new.id THEN
          RAISE (ABORT,'cannot change the value of any column that belongs to the primary key')
    END;
END;

DROP TRIGGER IF EXISTS update_ensure_child_primarykey;
CREATE TRIGGER update_ensure_child_primarykey
   BEFORE UPDATE ON main.child
BEGIN
  SELECT
    CASE
      WHEN old.id != new.id THEN
          RAISE (ABORT,'cannot change the value of any column that belongs to the primary key')
    END;
END;

DROP TRIGGER IF EXISTS insert_main_parent_into_oplog;
CREATE TRIGGER insert_main_parent_into_oplog
   AFTER INSERT ON main.parent
   WHEN 1 == (SELECT flag from trigger_settings WHERE tablename == 'main.parent')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'parent', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'value', new.value, 'otherValue', new.otherValue), NULL, NULL);
END;

DROP TRIGGER IF EXISTS update_main_parent_into_oplog;
CREATE TRIGGER update_main_parent_into_oplog
   AFTER UPDATE ON main.parent
   WHEN 1 == (SELECT flag from trigger_settings WHERE tablename == 'main.parent')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'parent', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'value', new.value, 'otherValue', new.otherValue), json_object('id', old.id, 'value', old.value, 'otherValue', old.otherValue), NULL);
END;

DROP TRIGGER IF EXISTS delete_main_parent_into_oplog;
CREATE TRIGGER delete_main_parent_into_oplog
   AFTER DELETE ON main.parent
   WHEN 1 == (SELECT flag from trigger_settings WHERE tablename == 'main.parent')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'parent', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'value', old.value, 'otherValue', old.otherValue), NULL);
END;

DROP TRIGGER IF EXISTS insert_main_child_into_oplog;
CREATE TRIGGER insert_main_child_into_oplog
   AFTER INSERT ON main.child
   WHEN 1 == (SELECT flag from trigger_settings WHERE tablename == 'main.parent')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'child', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'value', new.parent), NULL, NULL);
END;

DROP TRIGGER IF EXISTS update_main_child_into_oplog;
CREATE TRIGGER update_main_child_into_oplog
   AFTER UPDATE ON main.child
   WHEN 1 == (SELECT flag from trigger_settings WHERE tablename == 'main.child')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'child', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'value', new.parent), json_object('id', old.id, 'value', old.parent), NULL);
END;

DROP TRIGGER IF EXISTS delete_main_child_into_oplog;
CREATE TRIGGER delete_main_child_into_oplog
   AFTER DELETE ON main.child
   WHEN 1 == (SELECT flag from trigger_settings WHERE tablename == 'main.child')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES  ('main', 'child', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'parent', old.parent), NULL);
END;

DROP TRIGGER IF EXISTS compensation_insert_main_child_into_oplog;
CREATE TRIGGER compensation_insert_main_child_into_oplog
   AFTER INSERT ON main.child
   WHEN 1 == (SELECT flag from trigger_settings WHERE tablename == 'main.parent') AND
        1 == (SELECT value from _electric_meta WHERE key == 'compensations')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  SELECT 'main', 'parent', 'UPDATE', json_object('id', id), json_object('id', id, 'value', value, 'otherValue', otherValue), NULL, NULL
  FROM main.parent WHERE id = new.parent;
END;

DROP TRIGGER IF EXISTS compensation_update_main_child_into_oplog;
CREATE TRIGGER compensation_update_main_child_into_oplog
   AFTER UPDATE ON main.child
   WHEN 1 == (SELECT flag from trigger_settings WHERE tablename == 'main.parent') AND
        1 == (SELECT value from _electric_meta WHERE key == 'compensations')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  SELECT 'main', 'parent', 'UPDATE', json_object('id', id), json_object('id', id, 'value', value, 'otherValue', otherValue), NULL, NULL
  FROM main.parent WHERE id = new.parent;
END;
