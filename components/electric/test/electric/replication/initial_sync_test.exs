defmodule Electric.Replication.InitialSyncTest do
  use ExUnit.Case, async: false

  import Electric.Postgres.TestConnection
  import Electric.Utils, only: [uuid4: 0]

  alias Electric.Postgres.{CachedWal, Extension, Lsn}
  alias Electric.Replication.Changes.{NewRecord, Transaction}
  alias Electric.Replication.InitialSync

  require Logger

  @origin "initial-sync-test"
  @cached_wal_module CachedWal.EtsBacked
  @sleep_timeout 50

  describe "transactions" do
    setup ctx, do: Map.put(ctx, :origin, @origin)
    setup :setup_replicated_db

    test "returns the lsn=0 and no data for an empty DB", %{
      conn: conn,
      pg_connector_opts: pg_connector_opts
    } do
      # Verify that the cached LSN is not going to catch up since we don't have any electrified tables.
      assert :error == conn |> fetch_current_lsn() |> wait_for_cached_lsn_to_catch_up()

      assert {0, []} == InitialSync.transactions(pg_connector_opts)
    end

    test "returns the current lsn, electrified table migrations, and a single transaction containing all electrified data",
         %{
           conn: conn,
           pg_connector_opts: pg_connector_opts
         } do
      :ok = create_users_table(conn)
      :ok = create_documents_table(conn)

      :ok = electrify_table(conn, "public.users")

      [{user1_id, user1_name}, {user2_id, user2_name}] =
        users = [{uuid4(), "Mark"}, {uuid4(), "Stan"}]

      {:ok, 1} =
        :epgsql.equery(conn, "INSERT INTO public.users VALUES ($1, $2)", [
          user1_id,
          user1_name
        ])

      {:ok, 1} =
        :epgsql.equery(conn, "INSERT INTO public.users VALUES ($1, $2)", [
          user2_id,
          user2_name
        ])

      current_lsn = fetch_current_lsn(conn)

      [{doc_id, doc_title, _}] = [{uuid4(), "Test Document", user1_id}]

      {:ok, 1} =
        :epgsql.equery(conn, "INSERT INTO public.documents VALUES ($1, $2, $3)", [
          doc_id,
          doc_title,
          user1_id
        ])

      latest_lsn = fetch_current_lsn(conn)
      assert :ok == wait_for_cached_lsn_to_catch_up(current_lsn)

      assert {^current_lsn,
              [
                {%Transaction{
                   changes: [migration],
                   origin: "initial-sync-test",
                   lsn: 0
                 }, 0},
                {%Transaction{
                   changes: data_changes,
                   origin: "initial-sync-test",
                   lsn: ^current_lsn
                 }, ^current_lsn}
              ]} = InitialSync.transactions(pg_connector_opts)

      migration_version = Map.fetch!(migration.record, "version")

      expected_users =
        for {id, name} <- users do
          new_record("users", %{"id" => id, "name" => name})
        end

      migration_relation = Extension.ddl_relation()

      assert %NewRecord{
               relation: ^migration_relation,
               record: %{
                 "query" => "CREATE TABLE users" <> _,
                 "version" => ^migration_version
               },
               tags: []
             } = migration

      assert Enum.sort(expected_users) == Enum.sort(data_changes)

      # Verify that the cached WAL is not going to catch up to the latest LSN because the latest changes were made to a
      # non-electrified table.
      assert :error == wait_for_cached_lsn_to_catch_up(latest_lsn)
    end

    test "returns the current lsn, all electrified table migrations, and a single transaction containing all data",
         %{
           conn: conn,
           pg_connector_opts: pg_connector_opts
         } do
      :ok = create_users_table(conn)
      :ok = create_documents_table(conn)

      :ok = electrify_table(conn, "public.users")
      :ok = electrify_table(conn, "public.documents")

      [{user1_id, user1_name}, {user2_id, user2_name}] =
        users = [{uuid4(), "Mark"}, {uuid4(), "Stan"}]

      {:ok, 1} =
        :epgsql.equery(conn, "INSERT INTO public.users VALUES ($1, $2)", [
          user1_id,
          user1_name
        ])

      {:ok, 1} =
        :epgsql.equery(conn, "INSERT INTO public.users VALUES ($1, $2)", [
          user2_id,
          user2_name
        ])

      [{doc_id, doc_title, _}] = documents = [{uuid4(), "Test Document", user2_id}]

      {:ok, 1} =
        :epgsql.equery(conn, "INSERT INTO public.documents VALUES ($1, $2, $3)", [
          doc_id,
          doc_title,
          user2_id
        ])

      current_lsn = fetch_current_lsn(conn)
      assert :ok == wait_for_cached_lsn_to_catch_up(current_lsn)

      assert {^current_lsn,
              [
                {%Transaction{
                   changes: [migration1],
                   origin: "initial-sync-test",
                   lsn: 0
                 }, 0},
                {%Transaction{
                   changes: [migration2],
                   origin: "initial-sync-test",
                   lsn: 0
                 }, 0},
                {%Transaction{
                   changes: data_changes,
                   origin: "initial-sync-test",
                   lsn: ^current_lsn
                 }, ^current_lsn}
              ]} = InitialSync.transactions(pg_connector_opts)

      migration1_version = Map.fetch!(migration1.record, "version")
      migration2_version = Map.fetch!(migration2.record, "version")
      assert migration1_version < migration2_version

      expected_users =
        for {id, name} <- users do
          new_record("users", %{"id" => id, "name" => name})
        end

      expected_documents =
        for {id, title, user_id} <- documents do
          new_record("documents", %{"id" => id, "title" => title, "user_id" => user_id})
        end

      migration_relation = Extension.ddl_relation()

      assert [
               %NewRecord{
                 relation: ^migration_relation,
                 record: %{
                   "query" => "CREATE TABLE users" <> _,
                   "version" => ^migration1_version
                 },
                 tags: []
               },
               %NewRecord{
                 relation: ^migration_relation,
                 record: %{
                   "query" => "CREATE TABLE documents" <> _,
                   "version" => ^migration2_version
                 },
                 tags: []
               }
             ] = [migration1, migration2]

      assert Enum.sort(expected_users ++ expected_documents) == Enum.sort(data_changes)
    end
  end

  defp fetch_current_lsn(conn) do
    {:ok, _, [{lsn_str}]} = :epgsql.squery(conn, "SELECT pg_current_wal_lsn()")
    Lsn.from_string(lsn_str) |> Lsn.to_integer()
  end

  defp electrify_table(conn, name) do
    {:ok, [], []} = :epgsql.squery(conn, "CALL electric.electrify('#{name}')")
    :ok
  end

  defp create_users_table(conn) do
    {:ok, [], []} =
      :epgsql.squery(conn, """
      CREATE TABLE public.users (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL
      )
      """)

    :ok
  end

  defp create_documents_table(conn) do
    {:ok, [], []} =
      :epgsql.squery(conn, """
      CREATE TABLE public.documents (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        user_id UUID REFERENCES users(id)
      )
      """)

    :ok
  end

  defp new_record(relation, map) when is_binary(relation) do
    new_record({"public", relation}, map)
  end

  defp new_record(relation, map) do
    %NewRecord{relation: relation, record: map, tags: []}
  end

  # There's a delay between inserting some data into the DB and the moment it becomes available in the cached WAL. In
  # order to make unit tests deterministic, we need to wait until the cached WAL implementation has seen the given
  # LSN and only then verify the stream of changes in the cached WAL.
  defp wait_for_cached_lsn_to_catch_up(current_lsn, num_attempts \\ 5)
  defp wait_for_cached_lsn_to_catch_up(_current_lsn, 0), do: :error

  defp wait_for_cached_lsn_to_catch_up(current_lsn, num_attempts) do
    cached_lsn = CachedWal.Api.get_current_position(@cached_wal_module)

    if cached_lsn && cached_lsn == current_lsn do
      :ok
    else
      Process.sleep(@sleep_timeout)
      wait_for_cached_lsn_to_catch_up(current_lsn, num_attempts - 1)
    end
  end
end
