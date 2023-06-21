export default {
  "app": "linearlite",
  "build": "local",
  "console": {
    "host": "127.0.0.1",
    "port": 4000,
    "ssl": false
  },
  "debug": false,
  "env": "local",
  "migrations": [
    {
      "statements": [
        "CREATE TABLE \"issue\" (\n  \"id\" TEXT NOT NULL,\n  \"name\" TEXT NOT NULL,\n  \"priority\" TEXT NOT NULL,\n  \"title\" TEXT NOT NULL,\n  \"description\" TEXT NOT NULL,\n  \"status\" TEXT NOT NULL,\n  CONSTRAINT \"issue_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n",
        "\n    -- Toggles for turning the triggers on and off\n    INSERT OR IGNORE INTO _electric_trigger_settings(tablename,flag) VALUES ('main.issue', 1);\n    ",
        "\n    /* Triggers for table issue */\n  \n    -- ensures primary key is immutable\n    DROP TRIGGER IF EXISTS update_ensure_main_issue_primarykey;\n    ",
        "\n    CREATE TRIGGER update_ensure_main_issue_primarykey\n      BEFORE UPDATE ON main.issue\n    BEGIN\n      SELECT\n        CASE\n          WHEN old.id != new.id THEN\n\t\tRAISE (ABORT, 'cannot change the value of column id as it belongs to the primary key')\n        END;\n    END;\n    ",
        "\n    -- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table\n    DROP TRIGGER IF EXISTS insert_main_issue_into_oplog;\n    ",
        "\n    CREATE TRIGGER insert_main_issue_into_oplog\n       AFTER INSERT ON main.issue\n       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.issue')\n    BEGIN\n      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n      VALUES ('main', 'issue', 'INSERT', json_object('id', new.id), json_object('id', new.id, 'name', new.name, 'priority', new.priority, 'title', new.title, 'description', new.description, 'status', new.status), NULL, NULL);\n    END;\n    ",
        "\n    DROP TRIGGER IF EXISTS update_main_issue_into_oplog;\n    ",
        "\n    CREATE TRIGGER update_main_issue_into_oplog\n       AFTER UPDATE ON main.issue\n       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.issue')\n    BEGIN\n      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n      VALUES ('main', 'issue', 'UPDATE', json_object('id', new.id), json_object('id', new.id, 'name', new.name, 'priority', new.priority, 'title', new.title, 'description', new.description, 'status', new.status), json_object('id', old.id, 'name', old.name, 'priority', old.priority, 'title', old.title, 'description', old.description, 'status', old.status), NULL);\n    END;\n    ",
        "\n    DROP TRIGGER IF EXISTS delete_main_issue_into_oplog;\n    ",
        "\n    CREATE TRIGGER delete_main_issue_into_oplog\n       AFTER DELETE ON main.issue\n       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'main.issue')\n    BEGIN\n      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)\n      VALUES ('main', 'issue', 'DELETE', json_object('id', old.id), NULL, json_object('id', old.id, 'name', old.name, 'priority', old.priority, 'title', old.title, 'description', old.description, 'status', old.status), NULL);\n    END;\n    "
      ],
      "version": "20230621124748_973"
    }
  ],
  "replication": {
    "host": "127.0.0.1",
    "port": 5133,
    "ssl": false
  }
}