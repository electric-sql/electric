defmodule Electric.Postgres.ConfigurationTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit

  import Support.DbSetup

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

    test_pid = self()

    Repatch.patch(Postgrex, :query, fn conn, sql, params ->
      if String.starts_with?(sql, "ALTER TABLE"),
        do: send(test_pid, {:alter_table, sql, params})

      if String.starts_with?(sql, "ALTER PUBLICATION"),
        do: send(test_pid, {:alter_publication, sql, params})

      Repatch.real(Postgrex, :query, [conn, sql, params])
    end)

    :ok
  end

  describe "configure_publication!/3" do
    test "sets REPLICA IDENTITY on the table and adds it to the publication",
         %{pool: conn, publication_name: publication} do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert list_tables_in_publication(conn, publication) == []
      oid = get_table_oid(conn, {"public", "items"})
      oid_rel = {oid, {"public", "items"}}

      assert %{oid_rel => {:ok, :added}} ==
               Configuration.configure_publication!(conn, publication, MapSet.new([oid_rel]))

      assert get_table_identity(conn, {"public", "items"}) == "f"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters([{"public", "items"}])
    end

    test "doesn't execute `ALTER TABLE` if table identity is already full",
         %{pool: conn, publication_name: publication} do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert list_tables_in_publication(conn, publication) == []
      oid = get_table_oid(conn, {"public", "items"})
      oid_rel = {oid, {"public", "items"}}

      assert %{oid_rel => {:ok, :added}} ==
               Configuration.configure_publication!(conn, publication, MapSet.new([oid_rel]))

      assert_receive {:alter_table, _, _}
      assert get_table_identity(conn, {"public", "items"}) == "f"

      assert %{oid_rel => {:ok, :validated}} ==
               Configuration.configure_publication!(conn, publication, MapSet.new([oid_rel]))

      refute_receive {:alter_table, _, _}

      # Above we include the pid in the regex to ensure that the log message is from this test's process
      # otherwise this test can sporadically fail when run concurrently with other tests that log that message
    end

    test "works with multiple tables", %{pool: conn, publication_name: publication} do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert get_table_identity(conn, {"public", "other_table"}) == "d"
      assert list_tables_in_publication(conn, publication) == []
      oid1 = get_table_oid(conn, {"public", "items"})
      oid2 = get_table_oid(conn, {"public", "other_table"})
      oid_rel1 = {oid1, {"public", "items"}}
      oid_rel2 = {oid2, {"public", "other_table"}}

      assert %{
               oid_rel1 => {:ok, :added},
               oid_rel2 => {:ok, :added}
             } ==
               Configuration.configure_publication!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1, oid_rel2])
               )

      assert get_table_identity(conn, {"public", "items"}) == "f"
      assert get_table_identity(conn, {"public", "other_table"}) == "f"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters([{"public", "items"}, {"public", "other_table"}])
    end

    test "doesn't fail when one of the tables is already configured",
         %{pool: conn, publication_name: publication} do
      oid1 = get_table_oid(conn, {"public", "items"})
      oid2 = get_table_oid(conn, {"public", "other_table"})
      oid_rel1 = {oid1, {"public", "items"}}
      oid_rel2 = {oid2, {"public", "other_table"}}

      assert %{oid_rel1 => {:ok, :added}} ==
               Configuration.configure_publication!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1])
               )

      assert get_table_identity(conn, {"public", "other_table"}) == "d"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters([{"public", "items"}])

      # Configure `items` table again but with a different list of selected columns
      assert %{oid_rel1 => {:ok, :validated}, oid_rel2 => {:ok, :added}} ==
               Configuration.configure_publication!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1, oid_rel2])
               )

      assert get_table_identity(conn, {"public", "items"}) == "f"
      assert get_table_identity(conn, {"public", "other_table"}) == "f"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters([{"public", "items"}, {"public", "other_table"}])
    end

    test "fails relation configuration when publication doesn't exist", %{pool: conn} do
      oid = get_table_oid(conn, {"public", "items"})
      oid_rel = {oid, {"public", "items"}}

      assert %{^oid_rel => {:error, %Postgrex.Error{postgres: %{code: :undefined_object}}}} =
               Configuration.configure_publication!(conn, "nonexistent", MapSet.new([oid_rel]))
    end

    test "fails relation configuration if timing out on lock", %{
      pool: conn,
      publication_name: publication
    } do
      oid1 = get_table_oid(conn, {"public", "items"})
      oid_rel1 = {oid1, {"public", "items"}}

      start_supervised(
        {Task,
         fn ->
           Postgrex.transaction(conn, fn conn ->
             Postgrex.query!(conn, "LOCK TABLE public.items IN ACCESS EXCLUSIVE MODE", [])
             Process.sleep(:infinity)
           end)
         end}
      )

      assert_raise DBConnection.ConnectionError, fn ->
        Configuration.configure_publication!(
          conn,
          publication,
          MapSet.new([oid_rel1]),
          500
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
      oid_rel1 = {oid1, {"public", "items"}}
      oid_rel2 = {oid2, {"public", "other_table"}}
      oid_rel3 = {oid3, {"public", "other_other_table"}}

      new_relations = MapSet.new([oid_rel1, oid_rel2, oid_rel3])

      # Create the publication first
      assert %{oid_rel1 => {:ok, :added}, oid_rel2 => {:ok, :added}, oid_rel3 => {:ok, :added}} ==
               Configuration.configure_publication!(conn, publication, new_relations)

      expected_result = %{
        oid_rel1 => {:ok, :validated},
        oid_rel2 => {:ok, :validated},
        oid_rel3 => {:ok, :validated}
      }

      task1 =
        Task.async(fn ->
          Configuration.configure_publication!(
            conn,
            publication,
            new_relations
          )
        end)

      task2 =
        Task.async(fn ->
          Configuration.configure_publication!(conn, publication, new_relations)
        end)

      # First check: both tasks completed successfully, that means there were no deadlocks
      assert [expected_result, expected_result] == Task.await_many([task1, task2])

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
      oid_rel1 = {oid1, {"public", "items"}}

      assert %{oid_rel1 => {:ok, :added}} ==
               Configuration.configure_publication!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1])
               )

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
      assert %{oid_rel1 => {:error, :schema_changed}} ==
               Configuration.configure_publication!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1])
               )

      assert list_tables_in_publication(conn, publication) == []
    end
  end

  describe "validate_publication_configuration!/3" do
    test "validates that relations are correctly configured", %{
      pool: conn,
      publication_name: publication
    } do
      oid1 = get_table_oid(conn, {"public", "items"})
      oid2 = get_table_oid(conn, {"public", "other_table"})
      oid_rel1 = {oid1, {"public", "items"}}
      oid_rel2 = {oid2, {"public", "other_table"}}

      assert %{oid_rel1 => {:ok, :added}, oid_rel2 => {:ok, :added}} ==
               Configuration.configure_publication!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1, oid_rel2])
               )

      assert %{oid_rel1 => {:ok, :validated}, oid_rel2 => {:ok, :validated}} ==
               Configuration.validate_publication_configuration!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1, oid_rel2])
               )
    end

    test "fails relations that aren't in the publication", %{
      pool: conn,
      publication_name: publication
    } do
      oid1 = get_table_oid(conn, {"public", "items"})
      oid2 = get_table_oid(conn, {"public", "other_table"})
      oid3 = get_table_oid(conn, {"public", "other_other_table"})
      oid_rel1 = {oid1, {"public", "items"}}
      oid_rel2 = {oid2, {"public", "other_table"}}
      oid_rel3 = {oid3, {"public", "other_other_table"}}

      assert %{oid_rel1 => {:ok, :added}} ==
               Configuration.configure_publication!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1])
               )

      assert %{
               oid_rel1 => {:ok, :validated},
               oid_rel2 => {:error, :relation_missing_from_publication},
               oid_rel3 => {:error, :relation_missing_from_publication}
             } ==
               Configuration.validate_publication_configuration!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1, oid_rel2, oid_rel3])
               )
    end

    test "fails relations that don't have replica identity set to FULL", %{
      pool: conn,
      publication_name: publication
    } do
      oid = get_table_oid(conn, {"public", "items"})
      oid_rel = {oid, {"public", "items"}}

      assert %{oid_rel => {:ok, :added}} ==
               Configuration.configure_publication!(
                 conn,
                 publication,
                 MapSet.new([oid_rel])
               )

      Postgrex.query!(conn, "ALTER TABLE public.items REPLICA IDENTITY DEFAULT", [])

      assert %{oid_rel => {:error, :misconfigured_replica_identity}} ==
               Configuration.validate_publication_configuration!(
                 conn,
                 publication,
                 MapSet.new([oid_rel])
               )
    end

    test "returns invalidated relations", %{
      pool: conn,
      publication_name: publication
    } do
      oid1 = get_table_oid(conn, {"public", "items"})
      oid2 = get_table_oid(conn, {"public", "other_table"})
      oid_rel1 = {oid1, {"public", "items"}}
      oid_rel2 = {oid2, {"public", "other_table"}}

      assert %{oid_rel1 => {:ok, :added}} ==
               Configuration.configure_publication!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1])
               )

      # Rename one table and recreate the other
      Postgrex.query!(conn, "ALTER TABLE items RENAME TO items_old", [])
      Postgrex.query!(conn, "DROP TABLE public.other_table", [])

      Postgrex.query!(
        conn,
        "CREATE TABLE public.other_table (id UUID PRIMARY KEY, value TEXT NOT NULL)",
        []
      )

      # Should return invalidated relations
      assert %{
               oid_rel1 => {:error, :schema_changed},
               oid_rel2 => {:error, :schema_changed}
             } ==
               Configuration.validate_publication_configuration!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1, oid_rel2])
               )

      assert list_tables_in_publication(conn, publication) == [{"public", "items_old"}]
    end
  end

  describe "check_publication_status!/2" do
    test "detects if publication is missing", %{pool: conn} do
      assert :not_found = Configuration.check_publication_status!(conn, "nonexistent")
    end

    test "detects if publication doesn't publish all operations", %{
      pool: conn,
      publication_name: publication
    } do
      Postgrex.query!(conn, "ALTER PUBLICATION \"#{publication}\" SET (publish = 'insert')", [])

      assert %{
               publishes_all_operations?: false
             } = Configuration.check_publication_status!(conn, publication)
    end

    test "detects if publication isn't owned by the current user", %{
      pool: conn,
      publication_name: publication
    } do
      role_name = "other_user_#{System.unique_integer([:positive])}"
      Postgrex.query!(conn, "CREATE ROLE #{role_name} NOLOGIN", [])
      Postgrex.query!(conn, "ALTER PUBLICATION \"#{publication}\" OWNER TO #{role_name}", [])

      assert %{
               can_alter_publication?: false
             } = Configuration.check_publication_status!(conn, publication)
    end

    test "detects if publication supports generated columns", %{
      pool: conn,
      publication_name: publication
    } do
      pg_version = Support.TestUtils.fetch_pg_version(conn)

      if pg_version < 180_000 do
        assert %{
                 publishes_generated_columns?: false
               } = Configuration.check_publication_status!(conn, publication)
      else
        Postgrex.query!(
          conn,
          "ALTER PUBLICATION \"#{publication}\" SET (publish_generated_columns = 'none')",
          []
        )

        assert %{
                 publishes_generated_columns?: false
               } = Configuration.check_publication_status!(conn, publication)

        Postgrex.query!(
          conn,
          "ALTER PUBLICATION \"#{publication}\" SET (publish_generated_columns = 'stored')",
          []
        )

        assert %{
                 publishes_generated_columns?: true
               } = Configuration.check_publication_status!(conn, publication)
      end
    end

    test "detects if publication exists, publishes all operations and is owned by the current user",
         %{pool: conn, publication_name: publication} do
      assert %{
               can_alter_publication?: true,
               publishes_all_operations?: true
             } = Configuration.check_publication_status!(conn, publication)
    end
  end

  describe "concurrent publication updates" do
    @tag slow: true
    @tag connection_opt_overrides: [pool_size: 10, queue_target: 1_000, queue_interval: 20_000]
    test "should not cause deadlocks", %{
      pool: conn,
      publication_name: publication
    } do
      num_relations = 10
      num_to_pick = div(num_relations, 3)

      deadlock_oid_rels =
        for i <- 1..num_relations do
          table_name = "deadlock_table_#{i}"

          Postgrex.query!(
            conn,
            """
            CREATE TABLE #{table_name} (
              id UUID PRIMARY KEY,
              value TEXT NOT NULL
            )
            """,
            []
          )

          table_oid = get_table_oid(conn, {"public", table_name})
          {table_oid, {"public", table_name}}
        end
        |> MapSet.new()

      tasks =
        for _i <- 1..30 do
          Task.async(fn ->
            Configuration.configure_publication!(
              conn,
              publication,
              Enum.take_random(deadlock_oid_rels, num_to_pick) |> MapSet.new()
            )
          end)
        end

      error_results =
        Task.await_many(tasks, 60_000)
        |> Enum.flat_map(& &1)
        |> Enum.filter(&match?({_, {:error, _}}, &1))

      assert error_results == []
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
