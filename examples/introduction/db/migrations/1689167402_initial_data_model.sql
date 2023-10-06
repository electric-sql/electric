BEGIN;
  SELECT electric.migration_version('1689167402');
  SET SEARCH_PATH = public;

  -- Demos are instances of the demo applications.
  -- They are named and belong to a session.
  CREATE TABLE demos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,

    inserted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    electric_user_id TEXT NOT NULL
  );

  -- Sliders represent UI slider components.
  CREATE TABLE sliders (
    id TEXT PRIMARY KEY,
    value INTEGER NOT NULL,

    demo_id TEXT NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
    demo_name TEXT NOT NULL,

    electric_user_id TEXT NOT NULL
  );

  -- Items are simple objects that can be added and removed.
  CREATE TABLE items (
    id TEXT PRIMARY KEY,

    demo_id TEXT NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
    demo_name TEXT NOT NULL,

    inserted_at TEXT NOT NULL,

    electric_user_id TEXT NOT NULL
  );

  -- Players can be enrolled in tournaments.
  CREATE TABLE tournaments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,

    demo_id TEXT NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
    demo_name TEXT NOT NULL,

    inserted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    electric_user_id TEXT NOT NULL
  );
  CREATE TABLE players (
    id TEXT PRIMARY KEY,
    color TEXT NOT NULL,

    demo_id TEXT NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
    demo_name TEXT NOT NULL,

    tournament_id TEXT REFERENCES tournaments(id) ON DELETE SET NULL,

    inserted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    electric_user_id TEXT NOT NULL
  );

  -- ⚡
  -- Electrify the tables
  ALTER TABLE demos ENABLE ELECTRIC;
  ALTER TABLE sliders ENABLE ELECTRIC;
  ALTER TABLE items ENABLE ELECTRIC;
  ALTER TABLE players ENABLE ELECTRIC;
  ALTER TABLE tournaments ENABLE ELECTRIC;
COMMIT;
