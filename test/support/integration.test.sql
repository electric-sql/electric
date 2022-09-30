/*
Initial migration for Satellite with compensations

- Table for storing key-value pairs for storing Satellite metadata
- Table for enabling/disabling triggers per table
- Triggers INSERT, UPDATE, DELETE per-table to record operation in the oplog
- Trigger per-table to prevent updates to primary key
- Trigger for INSERT and UPDATE and per-column(s) that is a FOREIGN KEY
*/

CREATE TABLE IF NOT EXISTS main.entries (
  id TEXT PRIMARY KEY,
  content TEXT,
  content_b TEXT
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

INSERT INTO _electric_meta(key,value) VALUES ('lastSentRowId','0'), ('ackRowId','0'), ('compensations', 0);

DROP TABLE IF EXISTS _trigger_settings;
CREATE TABLE _trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);

INSERT INTO _trigger_settings(tablename,flag) VALUES ('main.entries', 1);

DROP TRIGGER IF EXISTS update_ensure_entries_primarykey;
CREATE TRIGGER update_ensure_entries_primarykey
   BEFORE UPDATE ON main.entries
BEGIN
  SELECT
    CASE
      WHEN old.id != new.id THEN
          RAISE (ABORT,'cannot change the value of any column that belongs to the primary key')
    END;
END;

DROP TRIGGER IF EXISTS insert_main_entries_into_oplog;
CREATE TRIGGER insert_main_entries_into_oplog
   AFTER INSERT ON main.entries
   WHEN 1 == (SELECT flag from _trigger_settings WHERE tablename == 'main.entries')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'entries', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b), NULL, NULL);
END;

DROP TRIGGER IF EXISTS update_main_entries_into_oplog;
CREATE TRIGGER update_main_entries_into_oplog
   AFTER UPDATE ON main.entries
   WHEN 1 == (SELECT flag from _trigger_settings WHERE tablename == 'main.entries')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'entries', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b), json_object('id', old.id, 'content', old.content, 'content_b', old.content_b), NULL);
END;

DROP TRIGGER IF EXISTS delete_main_entries_into_oplog;
CREATE TRIGGER delete_main_entries_into_oplog
   AFTER DELETE ON main.entries
   WHEN 1 == (SELECT flag from _trigger_settings WHERE tablename == 'main.entries')
BEGIN
  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  VALUES ('main', 'entries', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'content', old.content, 'content_b', old.content_b), NULL);
END;