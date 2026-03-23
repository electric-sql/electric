CREATE TABLE IF NOT EXISTS maintainers (
  id TEXT PRIMARY KEY NOT NULL,
  github TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  location TEXT,
  avatar_url TEXT,
  contributions INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  language TEXT,
  stars INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id TEXT PRIMARY KEY NOT NULL,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  author_id TEXT NOT NULL REFERENCES maintainers(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL,
  url TEXT NOT NULL
);

-- Maintainers (real data from GitHub)
INSERT INTO maintainers (id, github, name, role, location, avatar_url, contributions) VALUES
  ('msfstef',       'msfstef',       'Stefanos Mousafeiris', 'Core team',       'Greece',          'https://avatars.githubusercontent.com/u/12274098?v=4', 270),
  ('KyleAMathews',  'KyleAMathews',  'Kyle Mathews',         'Core team',       'Salt Lake City',  'https://avatars.githubusercontent.com/u/71047?v=4',     221),
  ('alco',          'alco',          'Oleksii Sholik',       'Core team',       'Lucca, Italy',    'https://avatars.githubusercontent.com/u/207748?v=4',    213),
  ('icehaunter',    'icehaunter',    'Ilia Borovitinov',     'Core team',       NULL,              'https://avatars.githubusercontent.com/u/1357760?v=4',   190),
  ('thruflo',       'thruflo',       'James Arthur',         'CEO',             'San Francisco',   'https://avatars.githubusercontent.com/u/60015?v=4',     130),
  ('kevin-dp',      'kevin-dp',      'Kevin',                'Core team',       'Brussels',        'https://avatars.githubusercontent.com/u/17384006?v=4',  126),
  ('magnetised',    'magnetised',    'Garry Hill',           'Core team',       NULL,              'https://avatars.githubusercontent.com/u/17374?v=4',     121),
  ('balegas',       'balegas',       'Valter Balegas',       'Co-founder',      'Lisbon',          'https://avatars.githubusercontent.com/u/1048589?v=4',   25),
  ('samwillis',     'samwillis',     'Sam Willis',           'Contributor',     'Stamford, UK',    'https://avatars.githubusercontent.com/u/31130?v=4',     13),
  ('3dyuval',       '3dyuval',       'Yuval Dikerman',       'Contributor',     'Tel Aviv',        'https://avatars.githubusercontent.com/u/20738722?v=4',  5),
  ('yyx990803',     'yyx990803',     'Evan You',             'Vue/Vite creator','Singapore',       'https://avatars.githubusercontent.com/u/499550?v=4',    0);

-- Repos
INSERT INTO repos (id, name, description, language, stars) VALUES
  ('electric',           'electric',           'Sync engine for Postgres — partial replication, data delivery, and fan-out', 'Elixir',      9911),
  ('typescript-client',  'typescript-client',  'ElectricSQL TypeScript client library',                                     'TypeScript',   51),
  ('examples',           'examples',           'Example applications using ElectricSQL',                                    'JavaScript',   33),
  ('vaxine',             'vaxine',             'Rich-CRDT database based on AntidoteDB',                                   'Erlang',       123),
  ('postgres-wasm',      'postgres-wasm',      'Postgres compiled to WebAssembly',                                          'C',            84);

-- Real merged PRs (February 2026)
INSERT INTO pull_requests (id, repo_id, author_id, number, title, merged_at, url) VALUES
  (gen_random_uuid()::text, 'electric', 'KyleAMathews',  3889, 'Add Vercel CDN caching troubleshooting guide',                         '2026-02-20T16:00:00Z', 'https://github.com/electric-sql/electric/pull/3889'),
  (gen_random_uuid()::text, 'electric', 'alco',          3888, 'Fix parameter validation for 10+ sequential params',                   '2026-02-20T14:30:00Z', 'https://github.com/electric-sql/electric/pull/3888'),
  (gen_random_uuid()::text, 'electric', 'KyleAMathews',  3885, 'Add BigInt support for subset loading with int8 columns',              '2026-02-19T18:00:00Z', 'https://github.com/electric-sql/electric/pull/3885'),
  (gen_random_uuid()::text, 'electric', 'magnetised',    3874, 'fix(sync-service): Add disk usage to metrics',                         '2026-02-19T15:00:00Z', 'https://github.com/electric-sql/electric/pull/3874'),
  (gen_random_uuid()::text, 'electric', 'KyleAMathews',  3870, 'fix: use replication credentials for admin pool',                      '2026-02-19T11:00:00Z', 'https://github.com/electric-sql/electric/pull/3870'),
  (gen_random_uuid()::text, 'electric', 'magnetised',    3881, 'fix(electric-telemetry): Send disk usage in bytes',                    '2026-02-19T10:00:00Z', 'https://github.com/electric-sql/electric/pull/3881'),
  (gen_random_uuid()::text, 'electric', 'KyleAMathews',  3871, 'Fix missed updates between snapshot and stream resume',                '2026-02-19T09:00:00Z', 'https://github.com/electric-sql/electric/pull/3871'),
  (gen_random_uuid()::text, 'electric', 'alco',          3865, 'fix: Ensure ShapeCache.await_snapshot_start() cannot loop indefinitely','2026-02-19T08:00:00Z', 'https://github.com/electric-sql/electric/pull/3865'),
  (gen_random_uuid()::text, 'electric', 'KyleAMathews',  3862, 'Fix prefetch buffer serving GET responses to POST subset requests',    '2026-02-18T16:00:00Z', 'https://github.com/electric-sql/electric/pull/3862'),
  (gen_random_uuid()::text, 'electric', 'magnetised',    3866, 'fix(elixir-client): Cache busting params for expired shapes',          '2026-02-18T14:00:00Z', 'https://github.com/electric-sql/electric/pull/3866'),
  (gen_random_uuid()::text, 'electric', 'magnetised',    3868, 'fix(electric-telemetry): Handle non-existent storage-dir',             '2026-02-18T13:00:00Z', 'https://github.com/electric-sql/electric/pull/3868'),
  (gen_random_uuid()::text, 'electric', 'msfstef',       3858, 'chore: Add transaction stored count in exported metrics',              '2026-02-17T12:00:00Z', 'https://github.com/electric-sql/electric/pull/3858'),
  (gen_random_uuid()::text, 'electric', 'kevin-dp',      3820, 'Handle deprecated 204s and go into live state',                        '2026-02-17T10:00:00Z', 'https://github.com/electric-sql/electric/pull/3820'),
  (gen_random_uuid()::text, 'electric', 'alco',          3739, 'docs: Remove the leftover mention of row filtering',                   '2026-02-16T15:00:00Z', 'https://github.com/electric-sql/electric/pull/3739'),
  (gen_random_uuid()::text, 'electric', 'alco',          3811, 'Fix durable-streams GitHub URLs on website',                           '2026-02-16T11:00:00Z', 'https://github.com/electric-sql/electric/pull/3811'),
  (gen_random_uuid()::text, 'electric', 'thruflo',       3847, 'website: fix spacing issue',                                           '2026-02-13T16:00:00Z', 'https://github.com/electric-sql/electric/pull/3847'),
  (gen_random_uuid()::text, 'electric', 'thruflo',       3846, 'website: update homepage messaging',                                   '2026-02-13T15:00:00Z', 'https://github.com/electric-sql/electric/pull/3846'),
  (gen_random_uuid()::text, 'electric', 'KyleAMathews',  3809, 'Add POST support for subset queries to avoid URL length limits',       '2026-02-13T12:00:00Z', 'https://github.com/electric-sql/electric/pull/3809'),
  (gen_random_uuid()::text, 'electric', 'KyleAMathews',  3837, 'fix(typescript-client): handle non-array response bodies',             '2026-02-13T10:00:00Z', 'https://github.com/electric-sql/electric/pull/3837'),
  (gen_random_uuid()::text, 'electric', 'icehaunter',    3834, 'fix: metrics from consumer',                                           '2026-02-12T14:00:00Z', 'https://github.com/electric-sql/electric/pull/3834');
