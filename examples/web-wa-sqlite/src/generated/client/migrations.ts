export default [
  {
    "statements": [
      "CREATE TABLE \"items\" (\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"items_pkey\" PRIMARY KEY (\"value\")\n) WITHOUT ROWID;\n",
      "\n    -- Toggles for turning the triggers on and off\n    INSERT OR IGNORE INTO _electric_trigger_settings(tablename,flag) VALUES ('main.items', 1);\n    ",
      "\n    /* Triggers for table items */\n  \n    -- ensures primary key is immutable\n    DROP TRIGGER IF EXISTS update_ensure_main_items_primarykey;\n    ",
      "\n    CREATE TRIGGER update_ensure_main_items_primarykey\n      BEFORE UPDATE ON main.items\n    BEGIN\n      SELECT\n        CASE\n          WHEN old.value != new.value THEN\n\t\tRAISE (ABORT, 'cannot change the value of column value as it belongs to the primary key')\n        END;\n    END;\n    ",
      "\n    -- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table\n    DROP TRIGGER IF EXISTS insert_main_items_into_oplog;\n    ",
      "\n    CREATE TRIGGER insert_main_items_into_oplog\n       AFTER INSERT ON main.items\n       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\n    BEGIN\n      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n      VALUES ('main', 'items', 'INSERT', json_object('value', new.value), json_object('value', new.value), NULL, NULL);\n    END;\n    ",
      "\n    DROP TRIGGER IF EXISTS update_main_items_into_oplog;\n    ",
      "\n    CREATE TRIGGER update_main_items_into_oplog\n       AFTER UPDATE ON main.items\n       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\n    BEGIN\n      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n      VALUES ('main', 'items', 'UPDATE', json_object('value', new.value), json_object('value', new.value), json_object('value', old.value), NULL);\n    END;\n    ",
      "\n    DROP TRIGGER IF EXISTS delete_main_items_into_oplog;\n    ",
      "\n    CREATE TRIGGER delete_main_items_into_oplog\n       AFTER DELETE ON main.items\n       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\n    BEGIN\n      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n      VALUES ('main', 'items', 'DELETE', json_object('value', old.value), NULL, json_object('value', old.value), NULL);\n    END;\n    "
    ],
    "version": "20230810162118_614"
  },
  {
    "statements": [
      "ALTER TABLE \"items\" ADD COLUMN \"another\" TEXT;\n",
      "\n    -- Toggles for turning the triggers on and off\n    INSERT OR IGNORE INTO _electric_trigger_settings(tablename,flag) VALUES ('main.items', 1);\n    ",
      "\n    /* Triggers for table items */\n  \n    -- ensures primary key is immutable\n    DROP TRIGGER IF EXISTS update_ensure_main_items_primarykey;\n    ",
      "\n    CREATE TRIGGER update_ensure_main_items_primarykey\n      BEFORE UPDATE ON main.items\n    BEGIN\n      SELECT\n        CASE\n          WHEN old.value != new.value THEN\n\t\tRAISE (ABORT, 'cannot change the value of column value as it belongs to the primary key')\n        END;\n    END;\n    ",
      "\n    -- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table\n    DROP TRIGGER IF EXISTS insert_main_items_into_oplog;\n    ",
      "\n    CREATE TRIGGER insert_main_items_into_oplog\n       AFTER INSERT ON main.items\n       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\n    BEGIN\n      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n      VALUES ('main', 'items', 'INSERT', json_object('value', new.value), json_object('another', new.another, 'value', new.value), NULL, NULL);\n    END;\n    ",
      "\n    DROP TRIGGER IF EXISTS update_main_items_into_oplog;\n    ",
      "\n    CREATE TRIGGER update_main_items_into_oplog\n       AFTER UPDATE ON main.items\n       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\n    BEGIN\n      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n      VALUES ('main', 'items', 'UPDATE', json_object('value', new.value), json_object('another', new.another, 'value', new.value), json_object('another', old.another, 'value', old.value), NULL);\n    END;\n    ",
      "\n    DROP TRIGGER IF EXISTS delete_main_items_into_oplog;\n    ",
      "\n    CREATE TRIGGER delete_main_items_into_oplog\n       AFTER DELETE ON main.items\n       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.items')\n    BEGIN\n      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n      VALUES ('main', 'items', 'DELETE', json_object('value', old.value), NULL, json_object('another', old.another, 'value', old.value), NULL);\n    END;\n    "
    ],
    "version": "20230810162542_560"
  }
]