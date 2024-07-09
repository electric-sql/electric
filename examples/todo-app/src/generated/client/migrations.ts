export default [
  {
    "statements": [
      "CREATE TABLE \"todos\" (\n  \"id\" TEXT NOT NULL,\n  \"title\" TEXT NOT NULL,\n  \"completed\" INTEGER NOT NULL,\n  \"created_at\" TEXT NOT NULL,\n  CONSTRAINT \"todos_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n",
      "INSERT OR IGNORE INTO _electric_trigger_settings (namespace, tablename, flag) VALUES ('main', 'todos', 1);",
      "DROP TRIGGER IF EXISTS update_ensure_main_todos_primarykey;",
      "CREATE TRIGGER update_ensure_main_todos_primarykey\n  BEFORE UPDATE ON \"main\".\"todos\"\nBEGIN\n  SELECT\n    CASE\n      WHEN old.\"id\" != new.\"id\" THEN\n      \t\tRAISE (ABORT, 'cannot change the value of column id as it belongs to the primary key')\n    END;\nEND;",
      "DROP TRIGGER IF EXISTS insert_main_todos_into_oplog;",
      "CREATE TRIGGER insert_main_todos_into_oplog\n   AFTER INSERT ON \"main\".\"todos\"\n   WHEN 1 = (SELECT flag from _electric_trigger_settings WHERE namespace = 'main' AND tablename = 'todos')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'todos', 'INSERT', json_patch('{}', json_object('id', new.\"id\")), json_object('completed', new.\"completed\", 'created_at', new.\"created_at\", 'id', new.\"id\", 'title', new.\"title\"), NULL, NULL);\nEND;",
      "DROP TRIGGER IF EXISTS update_main_todos_into_oplog;",
      "CREATE TRIGGER update_main_todos_into_oplog\n   AFTER UPDATE ON \"main\".\"todos\"\n   WHEN 1 = (SELECT flag from _electric_trigger_settings WHERE namespace = 'main' AND tablename = 'todos')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'todos', 'UPDATE', json_patch('{}', json_object('id', new.\"id\")), json_object('completed', new.\"completed\", 'created_at', new.\"created_at\", 'id', new.\"id\", 'title', new.\"title\"), json_object('completed', old.\"completed\", 'created_at', old.\"created_at\", 'id', old.\"id\", 'title', old.\"title\"), NULL);\nEND;",
      "DROP TRIGGER IF EXISTS delete_main_todos_into_oplog;",
      "CREATE TRIGGER delete_main_todos_into_oplog\n   AFTER DELETE ON \"main\".\"todos\"\n   WHEN 1 = (SELECT flag from _electric_trigger_settings WHERE namespace = 'main' AND tablename = 'todos')\nBEGIN\n  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n  VALUES ('main', 'todos', 'DELETE', json_patch('{}', json_object('id', old.\"id\")), NULL, json_object('completed', old.\"completed\", 'created_at', old.\"created_at\", 'id', old.\"id\", 'title', old.\"title\"), NULL);\nEND;"
    ],
    "version": "1"
  }
]