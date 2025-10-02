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

      assert %{oid_rel => :ok} ==
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

      assert %{oid_rel => :ok} ==
               Configuration.configure_publication!(conn, publication, MapSet.new([oid_rel]))

      assert_receive {:alter_table, _, _}
      assert get_table_identity(conn, {"public", "items"}) == "f"

      assert %{oid_rel => :ok} ==
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
               oid_rel1 => :ok,
               oid_rel2 => :ok
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

      assert %{oid_rel1 => :ok} ==
               Configuration.configure_publication!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1])
               )

      assert get_table_identity(conn, {"public", "other_table"}) == "d"

      assert list_tables_in_publication(conn, publication) ==
               expected_filters([{"public", "items"}])

      # Configure `items` table again but with a different list of selected columns
      assert %{oid_rel1 => :ok, oid_rel2 => :ok} ==
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
      expected_result = %{oid_rel1 => :ok, oid_rel2 => :ok, oid_rel3 => :ok}

      # Create the publication first
      assert expected_result ==
               Configuration.configure_publication!(conn, publication, new_relations)

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

      assert %{oid_rel1 => :ok} ==
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
      assert %{oid_rel1 => {:error, :relation_invalidated}} ==
               Configuration.configure_publication!(
                 conn,
                 publication,
                 MapSet.new([oid_rel1])
               )

      assert list_tables_in_publication(conn, publication) == []
    end
  end

  describe "check_publication_status!/2" do
    test "raises if publication is missing", %{pool: conn} do
      assert_raise Electric.DbConfigurationError,
                   "Publication \"nonexistent\" not found in the database",
                   fn ->
                     Configuration.check_publication_status!(conn, "nonexistent")
                   end
    end

    test "raises if publication doesn't publish all operations", %{
      pool: conn,
      publication_name: publication
    } do
      Postgrex.query!(conn, "ALTER PUBLICATION \"#{publication}\" SET (publish = 'insert')", [])

      assert_raise Electric.DbConfigurationError,
                   "Publication \"#{publication}\" does not publish all required operations: INSERT, UPDATE, DELETE, TRUNCATE",
                   fn ->
                     Configuration.check_publication_status!(conn, publication)
                   end
    end

    test "raises if publication isn't owned by the current user", %{
      pool: conn,
      publication_name: publication
    } do
      role_name = "other_user_#{System.unique_integer([:positive])}"
      Postgrex.query!(conn, "CREATE ROLE #{role_name} NOLOGIN", [])
      Postgrex.query!(conn, "ALTER PUBLICATION \"#{publication}\" OWNER TO #{role_name}", [])

      assert_raise Electric.DbConfigurationError,
                   "Publication \"#{publication}\" is not owned by the provided user",
                   fn ->
                     Configuration.check_publication_status!(conn, publication)
                   end
    end

    test "succeeds if publication exists, publishes all operations and is owned by the current user",
         %{pool: conn, publication_name: publication} do
      assert :ok = Configuration.check_publication_status!(conn, publication)
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
