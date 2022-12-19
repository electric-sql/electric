{
  "migrations": [
    {
      "body": [
        "CREATE TABLE IF NOT EXISTS items (\n    id TEXT PRIMARY KEY,\n    content TEXT NOT NULL,\n    content_b TEXT DEFAULT ''\n);",
        "-- These are toggles for turning the triggers on and off\nDROP TABLE IF EXISTS _electric_trigger_settings;",
        "CREATE TABLE _electric_trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);",
        "INSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.items', 1);",
        "-- Ensures primary key is immutable\nDROP TRIGGER IF EXISTS update_ensure_main_items_primarykey;",
        "CREATE TRIGGER update_ensure_main_items_primarykey\n   BEFORE UPDATE ON main.items\nBEGIN\n  SELECT\n    CASE\n      WHEN old.id != new.id THEN\n        RAISE (ABORT,'cannot change the value of column id as it belongs to the primary key')\n    END;\nEND;",
        "-- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table\n\nDROP TRIGGER IF EXISTS insert_main_items_into_oplog;",
        "CREATE TRIGGER insert_main_items_into_oplog\n   AFTER INSERT ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b), NULL, NULL);\nEND;",
        "DROP TRIGGER IF EXISTS update_main_items_into_oplog;",
        "CREATE TRIGGER update_main_items_into_oplog\n   AFTER UPDATE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b), json_object('id', old.id, 'content', old.content, 'content_b', old.content_b), NULL);\nEND;",
        "DROP TRIGGER IF EXISTS delete_main_items_into_oplog;",
        "CREATE TRIGGER delete_main_items_into_oplog\n   AFTER DELETE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'content', old.content, 'content_b', old.content_b), NULL);\nEND;"
      ],
      "encoding": "escaped",
      "name": "1669232573_init",
      "sha256": "71c9fb0baab30a8268c5208bff0feaf1170ff65b1554f278e5bd1871a4fedbe3",
      "title": "init"
    },
    {
      "body": [
        "ALTER TABLE items ADD added_column TEXT DEFAULT '';",
        "-- These are toggles for turning the triggers on and off\nDROP TABLE IF EXISTS _electric_trigger_settings;",
        "CREATE TABLE _electric_trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);",
        "INSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.items', 1);",
        "-- Ensures primary key is immutable\nDROP TRIGGER IF EXISTS update_ensure_main_items_primarykey;",
        "CREATE TRIGGER update_ensure_main_items_primarykey\n   BEFORE UPDATE ON main.items\nBEGIN\n  SELECT\n    CASE\n      WHEN old.id != new.id THEN\n        RAISE (ABORT,'cannot change the value of column id as it belongs to the primary key')\n    END;\nEND;",
        "-- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table\n\nDROP TRIGGER IF EXISTS insert_main_items_into_oplog;",
        "CREATE TRIGGER insert_main_items_into_oplog\n   AFTER INSERT ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b, 'added_column', new.added_column), NULL, NULL);\nEND;",
        "DROP TRIGGER IF EXISTS update_main_items_into_oplog;",
        "CREATE TRIGGER update_main_items_into_oplog\n   AFTER UPDATE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b, 'added_column', new.added_column), json_object('id', old.id, 'content', old.content, 'content_b', old.content_b, 'added_column', old.added_column), NULL);\nEND;",
        "DROP TRIGGER IF EXISTS delete_main_items_into_oplog;",
        "CREATE TRIGGER delete_main_items_into_oplog\n   AFTER DELETE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'content', old.content, 'content_b', old.content_b, 'added_column', old.added_column), NULL);\nEND;"
      ],
      "encoding": "escaped",
      "name": "1669232634_add_column",
      "sha256": "bbc8419bca8eaeb3dc34251145022dd074129c50b488c0079a1b94cbf3346264",
      "title": "add_column"
    }
  ]
}
