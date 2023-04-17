{
  "app_id": "some-app",
  "migrations": [
    {
      "encoding": "escaped",
      "name": "20221219_130833_195_init",
      "satellite_body": [
        "CREATE TABLE IF NOT EXISTS items (\n    id TEXT PRIMARY KEY,\n    content TEXT NOT NULL,\n    content_text_null TEXT, content_text_null_default TEXT DEFAULT '', intvalue_null INTEGER, intvalue_null_default INTEGER DEFAULT 10\n) WITHOUT ROWID;",
        "INSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.items', 1);",
        "DROP TRIGGER IF EXISTS update_ensure_main_items_primarykey;",
        "CREATE TRIGGER update_ensure_main_items_primarykey\n   BEFORE UPDATE ON main.items\nBEGIN\n  SELECT\n    CASE\n      WHEN old.id != new.id THEN\n        RAISE (ABORT,'cannot change the value of column id as it belongs to the primary key')\n    END;\nEND;",
        "DROP TRIGGER IF EXISTS insert_main_items_into_oplog;",
        "CREATE TRIGGER insert_main_items_into_oplog\n   AFTER INSERT ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_text_null', new.content_text_null, 'content_text_null_default', new.content_text_null_default, 'intvalue_null', new.intvalue_null, 'intvalue_null_default', new.intvalue_null_default), NULL, NULL);\nEND;",
        "DROP TRIGGER IF EXISTS update_main_items_into_oplog;",
        "CREATE TRIGGER update_main_items_into_oplog\n   AFTER UPDATE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'content', new.content, 'content_text_null', new.content_text_null, 'content_text_null_default', new.content_text_null_default, 'intvalue_null', new.intvalue_null, 'intvalue_null_default', new.intvalue_null_default), json_object('id', old.id, 'content', old.content, 'content_text_null', old.content_text_null, 'content_text_null_default', old.content_text_null_default, 'intvalue_null', old.intvalue_null, 'intvalue_null_default', old.intvalue_null_default), NULL);\nEND;",
        "DROP TRIGGER IF EXISTS delete_main_items_into_oplog;",
        "CREATE TRIGGER delete_main_items_into_oplog\n   AFTER DELETE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'content', old.content, 'content_text_null', old.content_text_null, 'content_text_null_default', old.content_text_null_default, 'intvalue_null', old.intvalue_null, 'intvalue_null_default', old.intvalue_null_default), NULL);\nEND;"
      ],
      "encoding": "escaped",
      "name": "1669232573_init",
      "sha256": "71c9fb0baab30a8268c5208bff0feaf1170ff65b1554f278e5bd1871a4fedbe3",
      "title": "init"
    }
  ]
}
