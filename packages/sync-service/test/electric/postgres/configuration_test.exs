defmodule Electric.Postgres.ConfigurationTest do
  use ExUnit.Case, async: true
  import ExUnit.CaptureLog
  import Support.DbSetup

  alias Electric.Replication.PublicationManager.RelationFilter
  alias Electric.Replication.Eval
  alias Electric.Postgres.Configuration

  @pg_15 150_000

  setup :with_unique_db
  setup :with_publication
  setup :with_pg_version

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

    Postgrex.query!(
      conn,
      """
      CREATE TABLE other_other_table (
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
         %{pool: conn, publication_name: publication, pg_version: pg_version} do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert list_tables_in_publication(conn, publication) == []

      Configuration.configure_tables_for_replication!(
        conn,
        %{
          {"public", "items"} => %RelationFilter{
            relation: {"public", "items"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
          }
        },
        pg_version,
        publication
      )

      assert get_table_identity(conn, {"public", "items"}) == "f"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", "(value ~~* 'yes%'::text)"}
                 ],
                 pg_version
               )
    end

    test "doesn't execute `ALTER TABLE` if table identity is already full",
         %{pool: conn, publication_name: publication, pg_version: pg_version} do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert list_tables_in_publication(conn, publication) == []

      assert capture_log(fn ->
               Configuration.configure_tables_for_replication!(
                 conn,
                 %{
                   {"public", "items"} => %RelationFilter{
                     relation: {"public", "items"},
                     where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
                   }
                 },
                 pg_version,
                 publication
               )
             end) =~ "Altering identity"

      assert get_table_identity(conn, {"public", "items"}) == "f"

      refute capture_log(fn ->
               Configuration.configure_tables_for_replication!(
                 conn,
                 %{
                   {"public", "items"} => %RelationFilter{
                     relation: {"public", "items"},
                     where_clauses: [%Eval.Expr{query: "(value ILIKE 'no%')"}]
                   }
                 },
                 pg_version,
                 publication
               )
             end) =~ "Altering identity"
    end

    test "works with multiple tables", %{
      pool: conn,
      publication_name: publication,
      pg_version: pg_version
    } do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert get_table_identity(conn, {"public", "other_table"}) == "d"
      assert list_tables_in_publication(conn, publication) == []

      Configuration.configure_tables_for_replication!(
        conn,
        %{
          {"public", "items"} => %RelationFilter{
            relation: {"public", "items"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
          },
          {"public", "other_table"} => %RelationFilter{
            relation: {"public", "other_table"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE 'no%')"}]
          }
        },
        pg_version,
        publication
      )

      assert get_table_identity(conn, {"public", "items"}) == "f"
      assert get_table_identity(conn, {"public", "other_table"}) == "f"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", "(value ~~* 'yes%'::text)"},
                   {"public", "other_table", "(value ~~* 'no%'::text)"}
                 ],
                 pg_version
               )
    end

    test "can update existing where clauses by updating all tables", %{
      pool: conn,
      publication_name: publication,
      pg_version: pg_version
    } do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert get_table_identity(conn, {"public", "other_table"}) == "d"
      assert list_tables_in_publication(conn, publication) == []

      Configuration.configure_tables_for_replication!(
        conn,
        %{
          {"public", "items"} => %RelationFilter{
            relation: {"public", "items"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
          },
          {"public", "other_table"} => %RelationFilter{
            relation: {"public", "other_table"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE 'no%')"}]
          }
        },
        pg_version,
        publication
      )

      assert get_table_identity(conn, {"public", "items"}) == "f"
      assert get_table_identity(conn, {"public", "other_table"}) == "f"

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
        %{
          {"public", "items"} => %RelationFilter{
            relation: {"public", "items"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
          },
          {"public", "other_table"} => %RelationFilter{
            relation: {"public", "other_table"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
          }
        },
        pg_version,
        publication
      )

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", "(value ~~* 'yes%'::text)"},
                   {"public", "other_table", "(value ~~* 'yes%'::text)"}
                 ],
                 pg_version
               )
    end

    test "doesn't fail when one of the tables is already configured",
         %{pool: conn, publication_name: publication, pg_version: pg_version} do
      Configuration.configure_tables_for_replication!(
        conn,
        %{
          {"public", "items"} => %RelationFilter{
            relation: {"public", "items"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
          }
        },
        pg_version,
        publication
      )

      assert get_table_identity(conn, {"public", "other_table"}) == "d"

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
        %{
          {"public", "items"} => %RelationFilter{
            relation: {"public", "items"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE 'no%')"}]
          },
          {"public", "other_table"} => %RelationFilter{relation: {"public", "other_table"}}
        },
        pg_version,
        publication
      )

      assert get_table_identity(conn, {"public", "items"}) == "f"
      assert get_table_identity(conn, {"public", "other_table"}) == "f"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", "(value ~~* 'no%'::text)"},
                   {"public", "other_table", nil}
                 ],
                 pg_version
               )

      # Now configure it again but for a shape that has no where clause
      # the resulting publication should no longer have a filter for that table
      Configuration.configure_tables_for_replication!(
        conn,
        %{
          {"public", "items"} => %RelationFilter{relation: {"public", "items"}},
          {"public", "other_table"} => %RelationFilter{relation: {"public", "other_table"}}
        },
        pg_version,
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

    test "fails when a publication doesn't exist", %{pool: conn, pg_version: pg_version} do
      assert_raise Postgrex.Error, ~r/undefined_object/, fn ->
        Configuration.configure_tables_for_replication!(
          conn,
          %{
            {"public", "items"} => %RelationFilter{relation: {"public", "items"}}
          },
          pg_version,
          "nonexistent"
        )
      end
    end

    test "concurrent alters to the publication don't deadlock and run correctly", %{
      pool: conn,
      publication_name: publication,
      pg_version: pg_version
    } do
      # Create the publication first
      Configuration.configure_tables_for_replication!(
        conn,
        %{
          {"public", "items"} => %RelationFilter{
            relation: {"public", "items"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
          },
          {"public", "other_table"} => %RelationFilter{
            relation: {"public", "other_table"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE '1%')"}]
          },
          {"public", "other_other_table"} => %RelationFilter{
            relation: {"public", "other_other_table"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE '1%')"}]
          }
        },
        pg_version,
        publication
      )

      new_filters = %{
        {"public", "items"} => %RelationFilter{
          relation: {"public", "items"},
          where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
        },
        {"public", "other_table"} => %RelationFilter{
          relation: {"public", "other_table"},
          where_clauses: [%Eval.Expr{query: "(value ILIKE '2%')"}]
        },
        {"public", "other_other_table"} => %RelationFilter{
          relation: {"public", "other_other_table"},
          where_clauses: [%Eval.Expr{query: "(value ILIKE '2%')"}]
        }
      }

      task1 =
        Task.async(fn ->
          Postgrex.transaction(conn, fn conn ->
            Configuration.configure_tables_for_replication!(
              conn,
              new_filters,
              pg_version,
              publication
            )

            :ok
          end)
        end)

      task2 =
        Task.async(fn ->
          Postgrex.transaction(conn, fn conn ->
            Configuration.configure_tables_for_replication!(
              conn,
              new_filters,
              pg_version,
              publication
            )

            :ok
          end)
        end)

      # First check: both tasks completed successfully, that means there were no deadlocks
      assert [{:ok, :ok}, {:ok, :ok}] == Task.await_many([task1, task2])

      # Second check: the publication has the correct filters, that means one didn't override the other
      assert list_tables_in_publication(conn, publication) |> Enum.sort() ==
               expected_filters(
                 [
                   {"public", "items", "(value ~~* 'yes%'::text)"},
                   {"public", "other_other_table", "(value ~~* '2%'::text)"},
                   {"public", "other_table", "(value ~~* '2%'::text)"}
                 ],
                 pg_version
               )
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
    %{rows: [[pg_version]]} =
      Postgrex.query!(conn, "SELECT current_setting('server_version_num')::integer", [])

    list_tables_in_pub(conn, publication, pg_version)
  end

  defp list_tables_in_pub(conn, publication, pg_version) when pg_version < @pg_15 do
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

  defp expected_filters(filters, pg_version) when pg_version < @pg_15 do
    Enum.map(filters, fn {schema, table, _filter} -> {schema, table} end)
  end

  defp expected_filters(filters, _pg_version), do: filters
end
