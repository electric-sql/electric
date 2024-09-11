defmodule Electric.Postgres.ConfigurationTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Configuration

  setup {Support.DbSetup, :with_unique_db}
  setup {Support.DbSetup, :with_publication}
  setup {Support.DbSetup, :with_pg_version}

  setup %{db_conn: conn} do
    Postgrex.query!(
      conn,
      """
      CREATE TABLE items (
        id UUID PRIMARY KEY,
        value TEXT NOT NULL
      )
      """,
      []
    )

    Postgrex.query!(
      conn,
      """
      CREATE TABLE other_table (
        id UUID PRIMARY KEY,
        value TEXT NOT NULL
      )
      """,
      []
    )

    :ok
  end

  describe "configure_tables_for_replication!/3" do
    test "sets REPLICA IDENTITY on the table and adds it to the publication",
         %{pool: conn, publication_name: publication, get_pg_version: get_pg_version} do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert list_tables_in_publication(conn, publication) == []

      Configuration.configure_tables_for_replication!(
        conn,
        [{{"public", "items"}, "(value ILIKE 'yes%')"}],
        get_pg_version,
        publication
      )

      assert get_table_identity(conn, {"public", "items"}) == "f"

      pg_version = get_pg_version.()

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", "(value ~~* 'yes%'::text)"}
                 ],
                 pg_version
               )
    end

    test "works with multiple tables", %{
      pool: conn,
      publication_name: publication,
      get_pg_version: get_pg_version
    } do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert get_table_identity(conn, {"public", "other_table"}) == "d"
      assert list_tables_in_publication(conn, publication) == []

      Configuration.configure_tables_for_replication!(
        conn,
        [
          {{"public", "items"}, "(value ILIKE 'yes%')"},
          {{"public", "other_table"}, "(value ILIKE 'no%')"}
        ],
        get_pg_version,
        publication
      )

      assert get_table_identity(conn, {"public", "items"}) == "f"
      assert get_table_identity(conn, {"public", "other_table"}) == "f"

      pg_version = get_pg_version.()

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", "(value ~~* 'yes%'::text)"},
                   {"public", "other_table", "(value ~~* 'no%'::text)"}
                 ],
                 pg_version
               )
    end

    test "keeps all tables when updating one of them", %{
      pool: conn,
      publication_name: publication,
      get_pg_version: get_pg_version
    } do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert get_table_identity(conn, {"public", "other_table"}) == "d"
      assert list_tables_in_publication(conn, publication) == []

      Configuration.configure_tables_for_replication!(
        conn,
        [
          {{"public", "items"}, "(value ILIKE 'yes%')"},
          {{"public", "other_table"}, "(value ILIKE 'no%')"}
        ],
        get_pg_version,
        publication
      )

      assert get_table_identity(conn, {"public", "items"}) == "f"
      assert get_table_identity(conn, {"public", "other_table"}) == "f"

      pg_version = get_pg_version.()

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", "(value ~~* 'yes%'::text)"},
                   {"public", "other_table", "(value ~~* 'no%'::text)"}
                 ],
                 pg_version
               )

      Configuration.configure_tables_for_replication!(
        conn,
        [
          {{"public", "other_table"}, "(value ILIKE 'yes%')"}
        ],
        get_pg_version,
        publication
      )

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", "(value ~~* 'yes%'::text)"},
                   {"public", "other_table",
                    "((value ~~* 'no%'::text) OR (value ~~* 'yes%'::text))"}
                 ],
                 pg_version
               )
    end

    test "doesn't fail when one of the tables is already configured",
         %{pool: conn, publication_name: publication, get_pg_version: get_pg_version} do
      Configuration.configure_tables_for_replication!(
        conn,
        [{{"public", "items"}, "(value ILIKE 'yes%')"}],
        get_pg_version,
        publication
      )

      assert get_table_identity(conn, {"public", "other_table"}) == "d"

      pg_version = get_pg_version.()

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", "(value ~~* 'yes%'::text)"}
                 ],
                 pg_version
               )

      # Configure `items` table again but with a different where clause
      Configuration.configure_tables_for_replication!(
        conn,
        [{{"public", "items"}, "(value ILIKE 'no%')"}, {{"public", "other_table"}, nil}],
        get_pg_version,
        publication
      )

      assert get_table_identity(conn, {"public", "items"}) == "f"
      assert get_table_identity(conn, {"public", "other_table"}) == "f"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", "((value ~~* 'yes%'::text) OR (value ~~* 'no%'::text))"},
                   {"public", "other_table", nil}
                 ],
                 pg_version
               )

      # Now configure it again but for a shape that has no where clause
      # the resulting publication should no longer have a filter for that table
      Configuration.configure_tables_for_replication!(
        conn,
        [{{"public", "items"}, nil}, {{"public", "other_table"}, "(value ILIKE 'no%')"}],
        get_pg_version,
        publication
      )

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", nil},
                   {"public", "other_table", nil}
                 ],
                 pg_version
               )
    end

    test "fails when a publication doesn't exist", %{pool: conn, get_pg_version: get_pg_version} do
      assert_raise Postgrex.Error, ~r/undefined_object/, fn ->
        Configuration.configure_tables_for_replication!(
          conn,
          [{{"public", "items"}, nil}],
          get_pg_version,
          "nonexistent"
        )
      end
    end
  end

  defp get_table_identity(conn, {schema, table}) do
    %{rows: [[ident]]} =
      Postgrex.query!(
        conn,
        """
        SELECT relreplident
        FROM pg_class
        JOIN pg_namespace ON relnamespace = pg_namespace.oid
        WHERE relname = $2 AND nspname = $1
        """,
        [schema, table]
      )

    ident
  end

  defp list_tables_in_publication(conn, publication) do
    pg_version = Electric.ConnectionManager.query_pg_major_version(conn)
    list_tables_in_pub(conn, publication, pg_version)
  end

  defp list_tables_in_pub(conn, publication, pg_version) when pg_version <= 14 do
    Postgrex.query!(
      conn,
      "SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = $1 ORDER BY tablename",
      [publication]
    )
    |> Map.fetch!(:rows)
    |> Enum.map(&List.to_tuple/1)
  end

  defp list_tables_in_pub(conn, publication, _pg_version) do
    Postgrex.query!(
      conn,
      "SELECT schemaname, tablename, rowfilter FROM pg_publication_tables WHERE pubname = $1 ORDER BY tablename",
      [publication]
    )
    |> Map.fetch!(:rows)
    |> Enum.map(&List.to_tuple/1)
  end

  defp expected_filters(filters, pg_version) when pg_version <= 14 do
    Enum.map(filters, fn {schema, table, _filter} -> {schema, table} end)
  end

  defp expected_filters(filters, _pg_version), do: filters
end
