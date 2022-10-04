/*
ElectricDB Migration
{"metadata": {"title": "create_items_table", "name": "1664714702_create_items_table", "sha256": "f136a45a26caece7e20a4712bb19bed105e9deb72c4c61ed189ca1d571b0f47f"}}
*/

CREATE TABLE IF NOT EXISTS main.items (
  value TEXT PRIMARY KEY
) STRICT, WITHOUT ROWID;

/*---------------------------------------------
Below are templated triggers added by Satellite
---------------------------------------------*/


-- These are toggles for turning the triggers on and off
DROP TABLE IF EXISTS _electric_trigger_settings;
CREATE TABLE _electric_trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);
INSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.items', 1);


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




