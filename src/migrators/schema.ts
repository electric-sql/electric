export const data = {
  migrations: [
    {
      satellite_body: [
        '-- The ops log table\nCREATE TABLE IF NOT EXISTS _electric_oplog (\n  rowid INTEGER PRIMARY KEY AUTOINCREMENT,\n  namespace String NOT NULL,\n  tablename String NOT NULL,\n  optype String NOT NULL,\n  primaryKey String NOT NULL,\n  newRow String,\n  oldRow String,\n  timestamp TEXT\n);',
        '-- Somewhere to keep our metadata\nCREATE TABLE IF NOT EXISTS _electric_meta (\n  key TEXT,\n  value BLOB\n);',
        '-- Somewhere to track migrations\nCREATE TABLE IF NOT EXISTS _electric_migrations (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL UNIQUE,\n  sha256 TEXT NOT NULL,\n  applied_at TEXT NOT NULL\n);',
        "-- Initialisation of the metadata table\nINSERT INTO _electric_meta (key, value) VALUES ('compensations', 0), ('lastAckdRowId','0'), ('lastSentRowId', '0'), ('lsn', ''), ('clientId', ''), ('token', 'INITIAL_INVALID_TOKEN'), ('refreshToken', '');",
        '-- These are toggles for turning the triggers on and off\nDROP TABLE IF EXISTS _electric_trigger_settings;',
        'CREATE TABLE _electric_trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);',
      ],
      encoding: 'escaped',
      name: '1666288242_init',
      sha256:
        '065f6851ac11a34c6ed61e57d5d93a34252d1d8cd8eeeb73271e9e74586676ab',
      title: 'init',
    },
  ],
}
