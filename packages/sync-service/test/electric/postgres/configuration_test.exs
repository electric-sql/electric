defmodule Electric.Postgres.ConfigurationTest do
  use ExUnit.Case, async: true
  import ExUnit.CaptureLog
  import Support.DbSetup

  alias Electric.Replication.PublicationManager.RelationFilter
  alias Electric.Replication.Eval
  alias Electric.Postgres.Configuration

  setup :with_unique_db
  setup :with_publication

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

  describe "configure_publication!/4" do
    test "sets REPLICA IDENTITY on the table and adds it to the publication",
         %{pool: conn, publication_name: publication} do
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
                 publication
               )

      assert get_table_identity(conn, {"public", "items"}) == "f"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters([{"public", "items"}])
    end

    test "doesn't execute `ALTER TABLE` if table identity is already full",
         %{pool: conn, publication_name: publication} do
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
                 publication
               )
             end) =~ ~r"#{:erlang.pid_to_list(self())}.*Altering identity"

      # Above we include the pid in the regex to ensure that the log message is from this test's process
      # otherwise this test can sporadically fail when run concurrently with other tests that log that message
    end

    test "works with multiple tables", %{pool: conn, publication_name: publication} do
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
        publication
      )

      assert get_table_identity(conn, {"public", "items"}) == "f"
      assert get_table_identity(conn, {"public", "other_table"}) == "f"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters([{"public", "items"}, {"public", "other_table"}])
    end

    test "doesn't fail when one of the tables is already configured",
         %{pool: conn, publication_name: publication} do
      oid = get_table_oid(conn, {"public", "items"})
      oid2 = get_table_oid(conn, {"public", "other_table"})

      assert Configuration.configure_publication!(
               conn,
               [],
               %{
                 {oid, {"public", "items"}} => %RelationFilter{
                   relation: {"public", "items"},
                   where_clauses: [%Eval.Expr{query: "(value ILIKE 'yes%')"}],
                   selected_columns: ["id"]
                 }
               },
               publication
             ) == []

      assert get_table_identity(conn, {"public", "other_table"}) == "d"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters([{"public", "items"}])

      # Configure `items` table again but with a different list of selected columns
      assert Configuration.configure_publication!(
               conn,
               [{oid, {"public", "items"}}],
               %{
                 {oid, {"public", "items"}} => %RelationFilter{
                   relation: {"public", "items"},
                   selected_columns: ["id", "value"]
                 },
                 {oid2, {"public", "other_table"}} => %RelationFilter{
                   relation: {"public", "other_table"}
                 }
               },
               publication
             ) == []

      assert get_table_identity(conn, {"public", "items"}) == "f"
      assert get_table_identity(conn, {"public", "other_table"}) == "f"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters([{"public", "items"}, {"public", "other_table"}])
    end

    test "fails when a publication doesn't exist", %{pool: conn} do
      oid = get_table_oid(conn, {"public", "items"})

      assert_raise Postgrex.Error, ~r/undefined_object/, fn ->
        Configuration.configure_publication!(
          conn,
          [{oid, {"public", "items"}}],
          %{
            {oid, {"public", "items"}} => %RelationFilter{relation: {"public", "items"}}
          },
          "nonexistent"
        )
      end
    end

    test "concurrent alters to the publication don't deadlock and run correctly", %{
      pool: conn,
      publication_name: publication
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
            publication
          )
        end)

      task2 =
        Task.async(fn ->
          Configuration.configure_publication!(
            conn,
            Map.keys(new_filters),
            new_filters,
            publication
          )
        end)

      # First check: both tasks completed successfully, that means there were no deadlocks
      assert [[], []] == Task.await_many([task1, task2])

      # Second check: the publication has the correct filters, that means one didn't override the other
      assert list_tables_in_publication(conn, publication) |> Enum.sort() ==
               expected_filters([
                 {"public", "items"},
                 {"public", "other_other_table"},
                 {"public", "other_table"}
               ])
    end

    test "dropped table isn't re-added to the publication, even if recreated", %{
      pool: conn,
      publication_name: publication
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
               publication
             ) == []

      assert list_tables_in_publication(conn, publication) ==
               expected_filters([{"public", "items"}])

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
    Postgrex.query!(
      conn,
      "SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = $1 ORDER BY tablename",
      [publication]
    )
    |> Map.fetch!(:rows)
    |> Enum.map(&List.to_tuple/1)
  end

  defp expected_filters(filters), do: filters
end
