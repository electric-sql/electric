/*
Initial migration for Satellite

- Table for storing key-value pairs for storing Satellite metadata
- Table for enabling/disabling triggers per table
- Triggers INSERT, UPDATE, DELETE per-table to record operation in the oplog
- Trigger per-table to prevent updates to primary key
*/

CREATE TABLE IF NOT EXISTS main.items (
  id INTEGER PRIMARY KEY,
  value TEXT,
  otherValue INTEGER
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

INSERT INTO _electric_meta(key,value) VALUES ('ackRowId','0');

DROP TABLE IF EXISTS _trigger_settings;
CREATE TABLE _trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);

INSERT INTO _trigger_settings(tablename,flag) VALUES ('main.items', 1);

/*
  Can't change the primary key with UPDATE.
  We put this restriction until we figure out the best way to handle it
  One idea is to handle an UPDATE as a DELETE and INSERT.
  Will make a decision soon.
*/
DROP TRIGGER IF EXISTS update_ensure_items_primarykey;
CREATE TRIGGER update_ensure_items_primarykey
   BEFORE UPDATE ON main.items
BEGIN
  SELECT
    CASE
      WHEN old.id != new.id THEN /* all columns that are primary key */
          RAISE (ABORT,'cannot change the value of any column that belongs to the primary key')
    END;
END;

DROP TRIGGER IF EXISTS insert_main_items_into_oplog;
CREATE TRIGGER insert_main_items_into_oplog
   AFTER INSERT ON main.items
   WHEN 1 == (SELECT flag from _trigger_settings WHERE tablename == 'main.items')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'items','INSERT', json_object('id', new.id), json_object('id', new.id, 'value', new.value, 'otherValue', new.otherValue), NULL, NULL);
END;

DROP TRIGGER IF EXISTS update_main_items_into_oplog;
CREATE TRIGGER update_main_items_into_oplog
   AFTER UPDATE ON main.items
   WHEN 1 == (SELECT flag from _trigger_settings WHERE tablename == 'main.items')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'items','UPDATE', json_object('id', new.id), json_object('id', new.id, 'value', new.value, 'otherValue', new.otherValue), json_object('id', old.id, 'value', old.value, 'otherValue', old.otherValue), NULL);
END;

DROP TRIGGER IF EXISTS delete_main_items_into_oplog;
CREATE TRIGGER delete_main_items_into_oplog
   AFTER DELETE ON main.items
   WHEN 1 == (SELECT flag from _trigger_settings WHERE tablename == 'main.items')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'items','DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'value', old.value, 'otherValue', old.otherValue), NULL);
END;
