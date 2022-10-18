export const data = {
  migrations: [
    {
      body: [
        // '/*\nElectricDB Migration\n{"metadata": {"title": "init", "name": "1664714681_init", "sha256": "9a6381937b08ecf9ea3b5bd09741b0860b9f9a885e0154ac1fdea29352b2b5ba"}}\n*/\n\n/*---------------------------------------------\nBelow are templated triggers added by Satellite\n---------------------------------------------*/\n\n-- The ops log table\n',
        "CREATE TABLE IF NOT EXISTS _electric_oplog (\n  rowid INTEGER PRIMARY KEY AUTOINCREMENT,\n  namespace String NOT NULL,\n  tablename String NOT NULL,\n  optype String NOT NULL,\n  primaryKey String NOT NULL,\n  newRow String,\n  oldRow String,\n  timestamp TEXT\n);",
        // "\n\n-- Somewhere to keep our metadata\n
        "CREATE TABLE IF NOT EXISTS _electric_meta (\n  key TEXT,\n  value BLOB\n);",
        // "\n\n-- Somewhere to track migrations\n
        "CREATE TABLE IF NOT EXISTS _electric_migrations (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL UNIQUE,\n  sha256 TEXT NOT NULL,\n  applied_at TEXT NOT NULL\n);",
        // "\n\n-- Initialisation of the metadata table\n
        "INSERT INTO _electric_meta (key, value) VALUES ('compensations', '0'), ('lastAckdRowId','0'), ('lastSentRowId', '0'), ('lsn', 'MA==');",
        // "\n\n\n-- These are toggles for turning the triggers on and off\n
        "DROP TABLE IF EXISTS _electric_trigger_settings;",
        "\nCREATE TABLE _electric_trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);",
        // "\n\n\n",
      ],
      encoding: "escaped",
      name: "1664714681_init",
      sha256: "9a6381937b08ecf9ea3b5bd09741b0860b9f9a885e0154ac1fdea29352b2b5ba",
      title: "init",
    },
    {
      body: [
        // '/*\nElectricDB Migration\n{"metadata": {"title": "create_items_table", "name": "1664714702_create_items_table", "sha256": "f136a45a26caece7e20a4712bb19bed105e9deb72c4c61ed189ca1d571b0f47f"}}\n*/\n\n',
        "CREATE TABLE IF NOT EXISTS main.items (\n  value TEXT PRIMARY KEY\n) STRICT, WITHOUT ROWID;",
        // "\n\n/*---------------------------------------------\nBelow are templated triggers added by Satellite\n---------------------------------------------*/\n\n\n-- These are toggles for turning the triggers on and off\n
        "DROP TABLE IF EXISTS _electric_trigger_settings;",
        "\nCREATE TABLE _electric_trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);",
        "\nINSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.items', 1);",
        // "\n\n\n/* Triggers for table items */\n\n-- Ensures primary key is immutable\n
        "DROP TRIGGER IF EXISTS update_ensure_main_items_primarykey;",
        "\nCREATE TRIGGER update_ensure_main_items_primarykey\n   BEFORE UPDATE ON main.items\nBEGIN\n  SELECT\n    CASE\n      WHEN old.value != new.value THEN\n        RAISE (ABORT,'cannot change the value of column value as it belongs to the primary key')\n    END;\nEND;",
        // "\n\n-- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table\n\n
        "DROP TRIGGER IF EXISTS insert_main_items_into_oplog;",
        "\nCREATE TRIGGER insert_main_items_into_oplog\n   AFTER INSERT ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'INSERT', json_object('value', new.value), json_object('value', new.value), NULL, NULL);\nEND;",
        "\n\nDROP TRIGGER IF EXISTS update_main_items_into_oplog;",
        "\nCREATE TRIGGER update_main_items_into_oplog\n   AFTER UPDATE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'UPDATE', json_object('value', new.value), json_object('value', new.value), json_object('value', old.value), NULL);\nEND;",
        "\n\nDROP TRIGGER IF EXISTS delete_main_items_into_oplog;",
        "\nCREATE TRIGGER delete_main_items_into_oplog\n   AFTER DELETE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'DELETE', json_object('value', old.value), NULL, json_object('value', old.value), NULL);\nEND;\n\n\n\n\n",
      ],
      encoding: "escaped",
      name: "1664714702_create_items_table",
      sha256: "f136a45a26caece7e20a4712bb19bed105e9deb72c4c61ed189ca1d571b0f47f",
      title: "create_items_table",
    },
    {
      body: [
        // '/*\nElectricDB Migration\n{"metadata": {"title": "create_compensation_test_tables", "name": "1664727242_create_compensation_test_tables", "sha256": "fda9c8a1f86d0c67eec25b1b111c601ee505c1b9eafc32069ce40de4a2d83506"}}\n*/\n\n',
        "CREATE TABLE IF NOT EXISTS main.parent (\n  id INTEGER PRIMARY KEY,\n  value TEXT,\n  otherValue INTEGER DEFAULT 0\n) STRICT, WITHOUT ROWID;",
        "\n\nCREATE TABLE IF NOT EXISTS main.child (\n  id INTEGER PRIMARY KEY,\n  parent INTEGER NOT NULL,\n  FOREIGN KEY(parent) REFERENCES parent(id)\n) STRICT, WITHOUT ROWID;",
        // "\n\n/*---------------------------------------------\nBelow are templated triggers added by Satellite\n---------------------------------------------*/\n\n\n-- These are toggles for turning the triggers on and off\n
        "DROP TABLE IF EXISTS _electric_trigger_settings;",
        "\nCREATE TABLE _electric_trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);",
        "\nINSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.child', 1);",
        "\nINSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.items', 1);",
        "\nINSERT INTO _electric_trigger_settings(tablename,flag) VALUES ('main.parent', 1);",
        // "\n\n\n/* Triggers for table child */\n\n-- Ensures primary key is immutable\n
        "DROP TRIGGER IF EXISTS update_ensure_main_child_primarykey;",
        "CREATE TRIGGER update_ensure_main_child_primarykey\n   BEFORE UPDATE ON main.child\nBEGIN\n  SELECT\n    CASE\n      WHEN old.id != new.id THEN\n        RAISE (ABORT,'cannot change the value of column id as it belongs to the primary key')\n    END;\nEND;",
        //"\n\n-- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table\n\n",
        "DROP TRIGGER IF EXISTS insert_main_child_into_oplog;",
        "CREATE TRIGGER insert_main_child_into_oplog\n   AFTER INSERT ON main.child\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.child')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'child', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'parent', new.parent), NULL, NULL);\nEND;",
        "DROP TRIGGER IF EXISTS update_main_child_into_oplog;",
        "CREATE TRIGGER update_main_child_into_oplog\n   AFTER UPDATE ON main.child\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.child')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'child', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'parent', new.parent), json_object('id', old.id, 'parent', old.parent), NULL);\nEND;",
        "DROP TRIGGER IF EXISTS delete_main_child_into_oplog;",
        "CREATE TRIGGER delete_main_child_into_oplog\n   AFTER DELETE ON main.child\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.child')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'child', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'parent', old.parent), NULL);\nEND;",
        // "\n\n-- Triggers for foreign key compensations\n\n
        "DROP TRIGGER IF EXISTS compensation_insert_main_child_parent_into_oplog;",
        "CREATE TRIGGER compensation_insert_main_child_parent_into_oplog\n   AFTER INSERT ON main.child\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.parent') AND\n        '1' == (SELECT value from _electric_meta WHERE key == 'compensations')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  SELECT 'main', 'parent', 'UPDATE', json_object('id', id), json_object('id', id, 'value', value, 'otherValue', otherValue), NULL, NULL\n  FROM main.parent WHERE id = new.parent;\nEND;",
        "DROP TRIGGER IF EXISTS compensation_update_main_child_parent_into_oplog;\n",
        "CREATE TRIGGER compensation_update_main_child_parent_into_oplog\n   AFTER UPDATE ON main.child\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.parent') AND\n        1 == (SELECT value from _electric_meta WHERE key == 'compensations')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  SELECT 'main', 'parent', 'UPDATE', json_object('id', id), json_object('id', id, 'value', value, 'otherValue', otherValue), NULL, NULL\n  FROM main.parent WHERE id = new.parent;\nEND;",
        // "\n\n\n/* Triggers for table items */\n\n-- Ensures primary key is immutable\n",
        "DROP TRIGGER IF EXISTS update_ensure_main_items_primarykey;",
        "\nCREATE TRIGGER update_ensure_main_items_primarykey\n   BEFORE UPDATE ON main.items\nBEGIN\n  SELECT\n    CASE\n      WHEN old.value != new.value THEN\n        RAISE (ABORT,'cannot change the value of column value as it belongs to the primary key')\n    END;\nEND;",
        // "\n\n-- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table\n\n
        "DROP TRIGGER IF EXISTS insert_main_items_into_oplog;",
        "CREATE TRIGGER insert_main_items_into_oplog\n   AFTER INSERT ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'INSERT', json_object('value', new.value), json_object('value', new.value), NULL, NULL);\nEND;",
        "DROP TRIGGER IF EXISTS update_main_items_into_oplog;",
        "CREATE TRIGGER update_main_items_into_oplog\n   AFTER UPDATE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'UPDATE', json_object('value', new.value), json_object('value', new.value), json_object('value', old.value), NULL);\nEND;",
        "DROP TRIGGER IF EXISTS delete_main_items_into_oplog;\n",
        "CREATE TRIGGER delete_main_items_into_oplog\n   AFTER DELETE ON main.items\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'items', 'DELETE', json_object('value', old.value), NULL, json_object('value', old.value), NULL);\nEND;",
        //"\n\n\n\n\n/* Triggers for table parent */\n\n-- Ensures primary key is immutable\n
        "DROP TRIGGER IF EXISTS update_ensure_main_parent_primarykey;",
        "CREATE TRIGGER update_ensure_main_parent_primarykey\n   BEFORE UPDATE ON main.parent\nBEGIN\n  SELECT\n    CASE\n      WHEN old.id != new.id THEN\n        RAISE (ABORT,'cannot change the value of column id as it belongs to the primary key')\n    END;\nEND;",
        //"\n\n-- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table\n\n
        "DROP TRIGGER IF EXISTS insert_main_parent_into_oplog;\n",
        "CREATE TRIGGER insert_main_parent_into_oplog\n   AFTER INSERT ON main.parent\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.parent')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'parent', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'value', new.value, 'otherValue', new.otherValue), NULL, NULL);\nEND;",
        "DROP TRIGGER IF EXISTS update_main_parent_into_oplog;",
        "CREATE TRIGGER update_main_parent_into_oplog\n   AFTER UPDATE ON main.parent\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.parent')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'parent', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'value', new.value, 'otherValue', new.otherValue), json_object('id', old.id, 'value', old.value, 'otherValue', old.otherValue), NULL);\nEND;",
        "DROP TRIGGER IF EXISTS delete_main_parent_into_oplog;\n",
        "CREATE TRIGGER delete_main_parent_into_oplog\n   AFTER DELETE ON main.parent\n   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.parent')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'parent', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'value', old.value, 'otherValue', old.otherValue), NULL);\nEND;\n\n\n\n\n",
      ],
      encoding: "escaped",
      name: "1664727242_create_compensation_test_tables",
      sha256: "fda9c8a1f86d0c67eec25b1b111c601ee505c1b9eafc32069ce40de4a2d83506",
      title: "create_compensation_test_tables",
    },
  ],
};
