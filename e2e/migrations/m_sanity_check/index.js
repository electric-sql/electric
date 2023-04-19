{
  "app_id": "some-app",
  "migrations": [
    {
      "encoding": "escaped",
      "name": "20221219_130833_195_init",
      "satellite_body": [
        "CREATE TABLE IF NOT EXISTS items (\n    id TEXT PRIMARY KEY,\n    content TEXT NOT NULL,\n    content_b TEXT DEFAULT ''\n);",
        "CREATE TABLE IF NOT EXISTS other_items (\n    id TEXT PRIMARY KEY NOT NULL,\n    content TEXT NOT NULL,\n    content_b TEXT\n) WITHOUT ROWID;",        
        "INSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.items', 1);",
        "INSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.other_items', 1);",
        "DROP TRIGGER IF EXISTS update_ensure_main_items_primarykey;",
        "CREATE TRIGGER update_ensure_main_items_primarykey\n   BEFORE UPDATE ON main.items\nBEGIN\n  SELECT\n    CASE\n      WHEN old.id != new.id THEN\n        RAISE (ABORT,'cannot change the value of column id as it belongs to the primary key')\n    END;\nEND;",
        "DROP TRIGGER IF EXISTS insert_main_items_into_oplog;",
        "CREATE TRIGGER insert_main_items_into_oplog\n   AFTER INSERT ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b), NULL, NULL);\nEND;",
        "DROP TRIGGER IF EXISTS update_main_items_into_oplog;",
        "CREATE TRIGGER update_main_items_into_oplog\n   AFTER UPDATE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b), json_object('id', old.id, 'content', old.content, 'content_b', old.content_b), NULL);\nEND;",
        "DROP TRIGGER IF EXISTS delete_main_items_into_oplog;",
        "CREATE TRIGGER delete_main_items_into_oplog\n   AFTER DELETE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'content', old.content, 'content_b', old.content_b), NULL);\nEND;",
        "DROP TRIGGER IF EXISTS update_ensure_main_other_items_primarykey;",
        "CREATE TRIGGER update_ensure_main_other_items_primarykey\n   BEFORE UPDATE ON main.other_items\nBEGIN\n  SELECT\n    CASE\n      WHEN old.id != new.id THEN\n        RAISE (ABORT,'cannot change the value of column id as it belongs to the primary key')\n    END;\nEND;",
        "DROP TRIGGER IF EXISTS insert_main_other_items_into_oplog;",
        "CREATE TRIGGER insert_main_other_items_into_oplog\n   AFTER INSERT ON main.other_items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.other_items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'other_items', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b), NULL, NULL);\nEND;",
        "DROP TRIGGER IF EXISTS update_main_other_items_into_oplog;",
        "CREATE TRIGGER update_main_other_items_into_oplog\n   AFTER UPDATE ON main.other_items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.other_items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'other_items', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b), json_object('id', old.id, 'content', old.content, 'content_b', old.content_b), NULL);\nEND;",
        "DROP TRIGGER IF EXISTS delete_main_other_items_into_oplog;",
        "CREATE TRIGGER delete_main_other_items_into_oplog\n   AFTER DELETE ON main.other_items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.other_items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'other_items', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'content', old.content, 'content_b', old.content_b), NULL);\nEND;"
      ],
      "sha256": "52c0b30b758722a7597d91b56ff8356ae3425a64180ef3496bf9b951f3653b91",
      "title": "init"
    },
    {
      "encoding": "escaped",
      "name": "20221219_130928_483_add_column",
      "satellite_body": [
        "ALTER TABLE items ADD added_column TEXT DEFAULT '';",
        "DROP TABLE IF EXISTS _electric_trigger_settings;",
        "CREATE TABLE _electric_trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);",
        "INSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.items', 1);",
        "INSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.other_items', 1);",
        "DROP TRIGGER IF EXISTS update_ensure_main_items_primarykey;",
        "CREATE TRIGGER update_ensure_main_items_primarykey\n   BEFORE UPDATE ON main.items\nBEGIN\n  SELECT\n    CASE\n      WHEN old.id != new.id THEN\n        RAISE (ABORT,'cannot change the value of column id as it belongs to the primary key')\n    END;\nEND;",
        "DROP TRIGGER IF EXISTS insert_main_items_into_oplog;",
        "CREATE TRIGGER insert_main_items_into_oplog\n   AFTER INSERT ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b, 'added_column', new.added_column), NULL, NULL);\nEND;",
        "DROP TRIGGER IF EXISTS update_main_items_into_oplog;",
        "CREATE TRIGGER update_main_items_into_oplog\n   AFTER UPDATE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b, 'added_column', new.added_column), json_object('id', old.id, 'content', old.content, 'content_b', old.content_b, 'added_column', old.added_column), NULL);\nEND;",
        "DROP TRIGGER IF EXISTS delete_main_items_into_oplog;",
        "CREATE TRIGGER delete_main_items_into_oplog\n   AFTER DELETE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'content', old.content, 'content_b', old.content_b, 'added_column', old.added_column), NULL);\nEND;",
        "DROP TRIGGER IF EXISTS update_ensure_main_other_items_primarykey;",
        "CREATE TRIGGER update_ensure_main_other_items_primarykey\n   BEFORE UPDATE ON main.other_items\nBEGIN\n  SELECT\n    CASE\n      WHEN old.id != new.id THEN\n        RAISE (ABORT,'cannot change the value of column id as it belongs to the primary key')\n    END;\nEND;",
        "DROP TRIGGER IF EXISTS insert_main_other_items_into_oplog;",
        "CREATE TRIGGER insert_main_other_items_into_oplog\n   AFTER INSERT ON main.other_items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.other_items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'other_items', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b), NULL, NULL);\nEND;",
        "DROP TRIGGER IF EXISTS update_main_other_items_into_oplog;",
        "CREATE TRIGGER update_main_other_items_into_oplog\n   AFTER UPDATE ON main.other_items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.other_items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'other_items', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_b', new.content_b), json_object('id', old.id, 'content', old.content, 'content_b', old.content_b), NULL);\nEND;",
        "DROP TRIGGER IF EXISTS delete_main_other_items_into_oplog;",
        "CREATE TRIGGER delete_main_other_items_into_oplog\n   AFTER DELETE ON main.other_items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.other_items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'other_items', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'content', old.content, 'content_b', old.content_b), NULL);\nEND;"
      ],
      "sha256": "44af2844a96e1afedb8a2ebba93a19adaef56ef7614dbb0e6a40edbe0a26f3a7",
      "title": "add_column"
    }
  ]
}
