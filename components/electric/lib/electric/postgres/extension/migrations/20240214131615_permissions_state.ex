defmodule Electric.Postgres.Extension.Migrations.Migration_20240214131615_PermissionsState do
  alias Electric.Postgres.Extension
  alias Electric.Satellite.SatPerms

  @behaviour Extension.Migration

  @impl true
  def version, do: 2024_02_14_13_16_15

  @impl true
  def up(schema) do
    global_perms_table = Extension.global_perms_table()
    user_perms_table = Extension.user_perms_table()

    empty_rules =
      %SatPerms.Rules{id: 1} |> Protox.encode!() |> IO.iodata_to_binary() |> Base.encode16()

    [
      """
      CREATE TABLE #{global_perms_table} (
          id int8 NOT NULL PRIMARY KEY,
          parent_id int8 UNIQUE REFERENCES #{global_perms_table} (id) ON DELETE SET NULL,
          rules bytea NOT NULL,
          inserted_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      """,
      """
      CREATE UNIQUE INDEX ON #{global_perms_table} ((1)) WHERE parent_id IS NULL;
      """,
      """
      CREATE TABLE #{user_perms_table} (
          id serial8 NOT NULL PRIMARY KEY,
          parent_id int8 REFERENCES #{user_perms_table} (id) ON DELETE SET NULL,
          global_perms_id int8 NOT NULL REFERENCES #{global_perms_table} (id) ON DELETE CASCADE,
          user_id text NOT NULL,
          roles bytea NOT NULL,
          inserted_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      """,
      """
      CREATE UNIQUE INDEX ON #{user_perms_table} (user_id) WHERE parent_id IS NULL;
      """,
      """
      CREATE INDEX user_perms_user_id_idx ON #{user_perms_table} (user_id, id);
      """,
      """
      INSERT INTO #{global_perms_table} (id, rules) VALUES (1, '\\x#{empty_rules}'::bytea)
      """,
      """
      DROP TABLE IF EXISTS #{schema}.roles CASCADE
      """,
      """
      DROP TABLE IF EXISTS #{schema}.grants CASCADE
      """,
      """
      DROP TABLE IF EXISTS #{schema}.assignments CASCADE
      """,
      """
      DROP PROCEDURE IF EXISTS #{schema}.assign;
      """,
      """
      DROP PROCEDURE IF EXISTS #{schema}.unassign;
      """,
      """
      DROP PROCEDURE IF EXISTS #{schema}.grant;
      """,
      """
      DROP PROCEDURE IF EXISTS #{schema}.revoke;
      """,
      """
      DROP PROCEDURE IF EXISTS #{schema}.sqlite;
      """,
      """
      DROP FUNCTION IF EXISTS #{schema}.find_fk_to_table;
      """,
      """
      DROP FUNCTION IF EXISTS #{schema}.find_fk_for_column;
      """,
      """
      DROP FUNCTION IF EXISTS #{schema}.find_pk;
      """
    ]
  end

  @impl true
  def down(_schema) do
    []
  end
end
