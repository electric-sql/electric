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

    :ok
  end

  describe "configure publication" do
    test "adds table to publication", %{pool: conn, publication_name: publication} do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert list_tables_in_publication(conn, publication) == []
      oid = get_table_oid(conn, {"public", "items"})
      oid_rel = {oid, {"public", "items"}}

      assert :ok = Configuration.add_table_to_publication(conn, publication, oid_rel)

      assert list_tables_in_publication(conn, publication) == [{"public", "items"}]

      # idempotent
      assert :ok = Configuration.add_table_to_publication(conn, publication, oid_rel)
    end

    test "sets REPLICA IDENTITY on the table", %{pool: conn} do
      assert get_table_identity(conn, {"public", "items"}) == "d"
      oid = get_table_oid(conn, {"public", "items"})
      oid_rel = {oid, {"public", "items"}}

      assert :ok = Configuration.set_table_replica_identity_full(conn, oid_rel)

      assert get_table_identity(conn, {"public", "items"}) == "f"

      # idempotent
      assert :ok = Configuration.set_table_replica_identity_full(conn, oid_rel)
    end

    test "configures table for replication in publication and replica identity", %{
      pool: conn,
      publication_name: publication
    } do
      oid = get_table_oid(conn, {"public", "items"})
      oid_rel = {oid, {"public", "items"}}

      assert get_table_identity(conn, {"public", "items"}) == "d"
      assert list_tables_in_publication(conn, publication) == []

      assert :ok = Configuration.configure_table_for_replication(conn, publication, oid_rel)

      assert get_table_identity(conn, {"public", "items"}) == "f"
      assert list_tables_in_publication(conn, publication) == [{"public", "items"}]
    end

    test "drops table from publication", %{
      pool: conn,
      publication_name: publication
    } do
      oid = get_table_oid(conn, {"public", "items"})
      oid_rel = {oid, {"public", "items"}}

      assert list_tables_in_publication(conn, publication) == []

      assert :ok = Configuration.add_table_to_publication(conn, publication, oid_rel)

      assert list_tables_in_publication(conn, publication) == [{"public", "items"}]

      assert :ok = Configuration.drop_table_from_publication(conn, publication, oid_rel)

      assert list_tables_in_publication(conn, publication) == []

      # idempotent
      assert :ok = Configuration.drop_table_from_publication(conn, publication, oid_rel)
    end

    test "fails relation configuration when publication doesn't exist", %{pool: conn} do
      oid = get_table_oid(conn, {"public", "items"})
      oid_rel = {oid, {"public", "items"}}

      assert {:error, %Postgrex.Error{postgres: %{code: :undefined_object}}} =
               Configuration.add_table_to_publication(conn, "nonexistent", oid_rel)

      assert {:error, %Postgrex.Error{postgres: %{code: :undefined_object}}} =
               Configuration.configure_table_for_replication(conn, "nonexistent", oid_rel)

      assert {:error, %Postgrex.Error{postgres: %{code: :undefined_object}}} =
               Configuration.drop_table_from_publication(conn, "nonexistent", oid_rel)
    end

    test "fails relation configuration if timing out on lock", %{
      pool: conn,
      publication_name: publication
    } do
      oid = get_table_oid(conn, {"public", "items"})
      oid_rel = {oid, {"public", "items"}}
      test_pid = self()

      # Need to unlink the connection pool as the test prevents any backoffs and retries for
      # connections that fail, and timeouts and cancellations will lead to the pool dying
      # and timing issues can cause the test to fail because of that
      Process.unlink(conn)

      start_supervised!(
        Supervisor.child_spec(
          {Task,
           fn ->
             Postgrex.transaction(
               conn,
               fn conn ->
                 Postgrex.query!(conn, "LOCK TABLE public.items IN ACCESS EXCLUSIVE MODE", [])
                 send(test_pid, :table_locked)
                 receive(do: (_ -> :ok))
               end
             )
           end},
          restart: :temporary
        )
      )

      assert_receive :table_locked

      assert {:error,
              %DBConnection.ConnectionError{
                message: "connection is closed because of an error, disconnect or timeout"
              }} =
               Configuration.add_table_to_publication(conn, publication, oid_rel, 50)
    end
  end

  @empty_set MapSet.new()
  describe "determine_publication_relation_actions!/3" do
    setup %{db_conn: conn} do
      Postgrex.query!(
        conn,
        "CREATE TABLE other_table_1 (id UUID PRIMARY KEY, value TEXT NOT NULL)",
        []
      )

      Postgrex.query!(
        conn,
        "CREATE TABLE other_table_2 (id UUID PRIMARY KEY, value TEXT NOT NULL)",
        []
      )

      Postgrex.query!(
        conn,
        "CREATE TABLE other_table_3 (id UUID PRIMARY KEY, value TEXT NOT NULL)",
        []
      )

      :ok
    end

    test "determines necessary actions to configure provided relations", %{
      pool: conn,
      publication_name: publication
    } do
      oid1 = get_table_oid(conn, {"public", "items"})
      oid2 = get_table_oid(conn, {"public", "other_table_1"})
      oid3 = get_table_oid(conn, {"public", "other_table_2"})
      oid4 = get_table_oid(conn, {"public", "other_table_3"})
      oid_rel1 = {oid1, {"public", "items"}}
      oid_rel2 = {oid2, {"public", "other_table_1"}}
      oid_rel3 = {oid3, {"public", "other_table_2"}}
      oid_rel4 = {oid4, {"public", "other_table_3"}}
      oid_rel5 = {999_999, {"public", "nonexistent_table"}}

      assert :ok = Configuration.configure_table_for_replication(conn, publication, oid_rel1)
      assert :ok = Configuration.add_table_to_publication(conn, publication, oid_rel2)
      assert :ok = Configuration.add_table_to_publication(conn, publication, oid_rel4)

      assert %{
               to_preserve: MapSet.new([oid_rel1]),
               to_add: MapSet.new([oid_rel3]),
               to_configure_replica_identity: MapSet.new([oid_rel2, oid_rel3]),
               to_drop: MapSet.new([oid_rel4]),
               to_invalidate: MapSet.new([oid_rel5])
             } ==
               Configuration.determine_publication_relation_actions!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1, oid_rel2, oid_rel3, oid_rel5])
               )
    end

    test "returns invalidated relations", %{
      pool: conn,
      publication_name: publication
    } do
      oid1 = get_table_oid(conn, {"public", "items"})
      oid2 = get_table_oid(conn, {"public", "other_table_1"})
      oid_rel1 = {oid1, {"public", "items"}}
      oid_rel2 = {oid2, {"public", "other_table_1"}}
      oid_rel1_renamed = {oid1, {"public", "items_old"}}

      assert :ok = Configuration.configure_table_for_replication(conn, publication, oid_rel1)

      # Rename one table and recreate the other
      Postgrex.query!(conn, "ALTER TABLE items RENAME TO items_old", [])
      Postgrex.query!(conn, "DROP TABLE public.other_table_1", [])

      Postgrex.query!(
        conn,
        "CREATE TABLE public.other_table_1 (id UUID PRIMARY KEY, value TEXT NOT NULL)",
        []
      )

      # Should return invalidated relations
      assert %{
               to_invalidate: MapSet.new([oid_rel1, oid_rel2]),
               to_add: @empty_set,
               to_configure_replica_identity: @empty_set,
               to_drop: MapSet.new([oid_rel1_renamed]),
               to_preserve: @empty_set
             } ==
               Configuration.determine_publication_relation_actions!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1, oid_rel2])
               )
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
    @tag connection_opt_overrides: [pool_size: 50, queue_target: 10_000, queue_interval: 20_000]
    test "should not cause deadlocks", %{
      pool: conn,
      publication_name: publication
    } do
      num_relations = 10

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
        for _i <- 1..500 do
          Task.async(fn ->
            [oid_rel] = Enum.take_random(deadlock_oid_rels, 1)

            if Enum.random([true, false]) do
              Configuration.configure_table_for_replication(conn, publication, oid_rel, :infinity)
            else
              Configuration.drop_table_from_publication(conn, publication, oid_rel, :infinity)
            end
          end)
        end

      error_results =
        Task.await_many(tasks, 60_000)
        |> Enum.reject(&match?(:ok, &1))

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
end
