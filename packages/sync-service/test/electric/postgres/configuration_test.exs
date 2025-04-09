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
        value TEXT NOT NULL,
        value_c VARCHAR(255)
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

  describe "configure_publication!/3" do
    test "sets REPLICA IDENTITY on the table and adds it to the publication",
         %{pool: conn, publication_name: publication, pg_version: pg_version} do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert list_tables_in_publication(conn, publication) == []
      oid = get_table_oid(conn, {"public", "items"})

      assert [] ==
               Configuration.configure_publication!(
                 conn,
                 [],
                 %{
                   {oid, {"public", "items"}} => %RelationFilter{
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
      oid = get_table_oid(conn, {"public", "items"})

      assert capture_log(fn ->
               Configuration.configure_publication!(
                 conn,
                 [],
                 %{
                   {oid, {"public", "items"}} => %RelationFilter{
                     relation: {"public", "items"},
                     where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
                   }
                 },
                 pg_version,
                 publication
               )
             end) =~ ~r"#{:erlang.pid_to_list(self())}.*Altering identity"

      assert get_table_identity(conn, {"public", "items"}) == "f"

      refute capture_log(fn ->
               Configuration.configure_publication!(
                 conn,
                 [{oid, {"public", "items"}}],
                 %{
                   {oid, {"public", "items"}} => %RelationFilter{
                     relation: {"public", "items"},
                     where_clauses: [%Eval.Expr{query: "(value ILIKE 'no%')"}]
                   }
                 },
                 pg_version,
                 publication
               )
             end) =~ ~r"#{:erlang.pid_to_list(self())}.*Altering identity"

      # Above we include the pid in the regex to ensure that the log message is from this test's process
      # otherwise this test can sporadically fail when run concurrently with other tests that log that message
    end

    test "works with multiple tables", %{
      pool: conn,
      publication_name: publication,
      pg_version: pg_version
    } do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert get_table_identity(conn, {"public", "other_table"}) == "d"
      assert list_tables_in_publication(conn, publication) == []
      oid1 = get_table_oid(conn, {"public", "items"})
      oid2 = get_table_oid(conn, {"public", "other_table"})

      Configuration.configure_publication!(
        conn,
        [],
        %{
          {oid1, {"public", "items"}} => %RelationFilter{
            relation: {"public", "items"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
          },
          {oid2, {"public", "other_table"}} => %RelationFilter{
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
      oid1 = get_table_oid(conn, {"public", "items"})
      oid2 = get_table_oid(conn, {"public", "other_table"})

      assert Configuration.configure_publication!(
               conn,
               [],
               %{
                 {oid1, {"public", "items"}} => %RelationFilter{
                   relation: {"public", "items"},
                   where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
                 },
                 {oid2, {"public", "other_table"}} => %RelationFilter{
                   relation: {"public", "other_table"},
                   where_clauses: [%Eval.Expr{query: "(value ILIKE 'no%')"}]
                 }
               },
               pg_version,
               publication
             ) == []

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

      assert Configuration.configure_publication!(
               conn,
               [{oid1, {"public", "items"}}, {oid2, {"public", "other_table"}}],
               %{
                 {oid1, {"public", "items"}} => %RelationFilter{
                   relation: {"public", "items"},
                   where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
                 },
                 {oid2, {"public", "other_table"}} => %RelationFilter{
                   relation: {"public", "other_table"},
                   where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
                 }
               },
               pg_version,
               publication
             ) == []

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
      oid = get_table_oid(conn, {"public", "items"})
      oid2 = get_table_oid(conn, {"public", "other_table"})

      assert Configuration.configure_publication!(
               conn,
               [],
               %{
                 {oid, {"public", "items"}} => %RelationFilter{
                   relation: {"public", "items"},
                   where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
                 }
               },
               pg_version,
               publication
             ) == []

      assert get_table_identity(conn, {"public", "other_table"}) == "d"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", "(value ~~* 'yes%'::text)"}
                 ],
                 pg_version
               )

      # Configure `items` table again but with a different where clause
      assert Configuration.configure_publication!(
               conn,
               [{oid, {"public", "items"}}],
               %{
                 {oid, {"public", "items"}} => %RelationFilter{
                   relation: {"public", "items"},
                   where_clauses: [%Eval.Expr{query: "(value ILIKE 'no%')"}]
                 },
                 {oid2, {"public", "other_table"}} => %RelationFilter{
                   relation: {"public", "other_table"}
                 }
               },
               pg_version,
               publication
             ) == []

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
      assert Configuration.configure_publication!(
               conn,
               [{oid, {"public", "items"}}, {oid2, {"public", "other_table"}}],
               %{
                 {oid, {"public", "items"}} => %RelationFilter{relation: {"public", "items"}},
                 {oid2, {"public", "other_table"}} => %RelationFilter{
                   relation: {"public", "other_table"}
                 }
               },
               pg_version,
               publication
             ) == []

      assert list_tables_in_publication(conn, publication) ==
               expected_filters(
                 [
                   {"public", "items", nil},
                   {"public", "other_table", nil}
                 ],
                 pg_version
               )
    end

    test "fails with invalid where clause error when unsupported clause provided",
         %{pool: conn, publication_name: publication, pg_version: pg_version} do
      oid = get_table_oid(conn, {"public", "items"})

      if pg_version >= @pg_15 do
        error =
          assert_raise Postgrex.Error, fn ->
            Configuration.configure_publication!(
              conn,
              [],
              %{
                {oid, {"public", "items"}} => %RelationFilter{
                  relation: {"public", "items"},
                  where_clauses: [%Eval.Expr{query: "(value_c in ('a','b'))"}]
                }
              },
              pg_version,
              publication
            )
          end

        assert %Postgrex.Error{
                 postgres: %{
                   code: :feature_not_supported,
                   detail:
                     "Only columns, constants, built-in operators, built-in data types, built-in collations, and immutable built-in functions are allowed."
                 }
               } = error
      else
        # pg versions without row filtering should just accept this
        assert _ =
                 Configuration.configure_publication!(
                   conn,
                   [{oid, {"public", "items"}}],
                   %{
                     {oid, {"public", "items"}} => %RelationFilter{
                       relation: {"public", "items"},
                       where_clauses: [%Eval.Expr{query: "(value_c in ('a','b'))"}]
                     }
                   },
                   pg_version,
                   publication
                 )
      end
    end

    test "fails when a publication doesn't exist", %{pool: conn, pg_version: pg_version} do
      oid = get_table_oid(conn, {"public", "items"})

      assert_raise Postgrex.Error, ~r/undefined_object/, fn ->
        Configuration.configure_publication!(
          conn,
          [{oid, {"public", "items"}}],
          %{
            {oid, {"public", "items"}} => %RelationFilter{relation: {"public", "items"}}
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
      oid1 = get_table_oid(conn, {"public", "items"})
      oid2 = get_table_oid(conn, {"public", "other_table"})
      oid3 = get_table_oid(conn, {"public", "other_other_table"})

      # Create the publication first
      Configuration.configure_publication!(
        conn,
        [],
        %{
          {oid1, {"public", "items"}} => %RelationFilter{
            relation: {"public", "items"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
          },
          {oid2, {"public", "other_table"}} => %RelationFilter{
            relation: {"public", "other_table"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE '1%')"}]
          },
          {oid3, {"public", "other_other_table"}} => %RelationFilter{
            relation: {"public", "other_other_table"},
            where_clauses: [%Eval.Expr{query: "(value ILIKE '1%')"}]
          }
        },
        pg_version,
        publication
      )

      new_filters = %{
        {oid1, {"public", "items"}} => %RelationFilter{
          relation: {"public", "items"},
          where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
        },
        {oid2, {"public", "other_table"}} => %RelationFilter{
          relation: {"public", "other_table"},
          where_clauses: [%Eval.Expr{query: "(value ILIKE '2%')"}]
        },
        {oid3, {"public", "other_other_table"}} => %RelationFilter{
          relation: {"public", "other_other_table"},
          where_clauses: [%Eval.Expr{query: "(value ILIKE '2%')"}]
        }
      }

      task1 =
        Task.async(fn ->
          Configuration.configure_publication!(
            conn,
            Map.keys(new_filters),
            new_filters,
            pg_version,
            publication
          )
        end)

      task2 =
        Task.async(fn ->
          Configuration.configure_publication!(
            conn,
            Map.keys(new_filters),
            new_filters,
            pg_version,
            publication
          )
        end)

      # First check: both tasks completed successfully, that means there were no deadlocks
      assert [[], []] == Task.await_many([task1, task2])

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

    test "dropped table isn't re-added to the publication, even if recreated", %{
      pool: conn,
      publication_name: publication,
      pg_version: pg_version
    } do
      oid1 = get_table_oid(conn, {"public", "items"})

      assert Configuration.configure_publication!(
               conn,
               [],
               %{
                 {oid1, {"public", "items"}} => %RelationFilter{
                   relation: {"public", "items"},
                   where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}]
                 }
               },
               pg_version,
               publication
             ) == []

      assert list_tables_in_publication(conn, publication) ==
               expected_filters([{"public", "items", "(value ~~* 'yes%'::text)"}], pg_version)

      # Recreate the table
      Postgrex.query!(conn, "DROP TABLE public.items", [])

      Postgrex.query!(
        conn,
        "CREATE TABLE public.items (id UUID PRIMARY KEY, value TEXT NOT NULL)",
        []
      )

      # Adding a new where clause shoudn't re-add the table to the publication but should return that info
      assert Configuration.configure_publication!(
               conn,
               [{oid1, {"public", "items"}}],
               %{
                 {oid1, {"public", "items"}} => %RelationFilter{
                   relation: {"public", "items"},
                   where_clauses: [
                     %Eval.Expr{query: "(value ILIKE 'no%')"},
                     %Eval.Expr{query: "(value ILIKE 'yes%')"}
                   ]
                 }
               },
               pg_version,
               publication
             ) == [{oid1, {"public", "items"}}]

      assert list_tables_in_publication(conn, publication) == []
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

  defp get_table_oid(conn, {schema, table}) do
    %{rows: [[oid]]} =
      Postgrex.query!(
        conn,
        """
        SELECT pg_class.oid
        FROM pg_class
        JOIN pg_namespace ON relnamespace = pg_namespace.oid
        WHERE relname = $2 AND nspname = $1
        """,
        [schema, table]
      )

    oid
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
