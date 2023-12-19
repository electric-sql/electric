defmodule Electric.Replication.InitialSyncTest do
  use ExUnit.Case, async: false

  import Electric.Postgres.TestConnection

  alias Electric.Postgres.{CachedWal, Extension, Lsn}
  alias Electric.Replication.Changes.{NewRecord, Transaction}
  alias Electric.Replication.InitialSync
  alias Electric.Replication.Postgres.Client

  @origin "initial-sync-test"
  @sleep_timeout 500

  describe "migrations_since" do
    setup ctx, do: Map.put(ctx, :origin, @origin)
    setup :setup_replicated_db

    test "returns electrified table migrations", %{
      conn: conn,
      connector_config: connector_config
    } do
      origin = Electric.Replication.Connectors.origin(connector_config)

      :ok = create_users_table(conn)
      :ok = create_documents_table(conn)

      version_1 = "20230830140000"
      version_2 = "20230830140100"

      assert [] == InitialSync.migrations_since(nil, origin)

      :ok = electrify_table(conn, "public.users", version_1)

      # Wait for electrification to propagate through Postgres' logical replication
      current_lsn = fetch_current_lsn(conn)
      assert :ok == wait_for_cached_lsn_to_catch_up(current_lsn)

      assert [
               %Transaction{
                 changes: [migration],
                 origin: "initial-sync-test",
                 lsn: ^current_lsn,
                 xid: xid,
                 commit_timestamp: timestamp
               }
             ] = InitialSync.migrations_since(nil, origin, current_lsn)

      assert is_integer(xid)
      assert %DateTime{} = timestamp

      migration_relation = Extension.ddl_relation()

      assert %NewRecord{
               relation: ^migration_relation,
               record: %{
                 "query" => "CREATE TABLE users" <> _,
                 "version" => ^version_1
               },
               tags: []
             } = migration

      :ok = electrify_table(conn, "public.documents", version_2)

      # Wait for electrification to propagate through Postgres' logical replication
      current_lsn = fetch_current_lsn(conn)
      assert :ok == wait_for_cached_lsn_to_catch_up(current_lsn)

      assert [
               %Transaction{
                 changes: [migration1],
                 origin: "initial-sync-test",
                 lsn: ^current_lsn,
                 xid: xid1,
                 commit_timestamp: timestamp1
               },
               %Transaction{
                 changes: [migration2],
                 origin: "initial-sync-test",
                 lsn: ^current_lsn,
                 xid: xid2,
                 commit_timestamp: timestamp2
               }
             ] = InitialSync.migrations_since(nil, origin, current_lsn)

      assert is_integer(xid1)
      assert is_integer(xid2)
      assert xid1 < xid2

      assert %DateTime{} = timestamp1
      assert %DateTime{} = timestamp2

      migration1_version = Map.fetch!(migration1.record, "version")
      migration2_version = Map.fetch!(migration2.record, "version")
      assert migration1_version < migration2_version

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
    end
  end

  defp fetch_current_lsn(conn) do
    {:ok, _, [{lsn_str}]} = :epgsql.squery(conn, "SELECT pg_current_wal_lsn()")
    Lsn.from_string(lsn_str) |> Lsn.to_integer()
  end

  defp electrify_table(conn, name, version) do
    Client.with_transaction(conn, fn tx_conn ->
      {:ok, [], []} = :epgsql.squery(tx_conn, "CALL electric.electrify('#{name}')")

      {:ok, [], []} =
        :epgsql.squery(tx_conn, "CALL electric.migration_version('#{version}')")
    end)

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

  # There's a delay between inserting some data into the DB and the moment it becomes available in the cached WAL. In
  # order to make unit tests deterministic, we need to wait until the cached WAL implementation has seen the given
  # LSN and only then verify the stream of changes in the cached WAL.

  defp wait_for_cached_lsn_to_catch_up(current_lsn) do
    {:ok, ref} = CachedWal.Api.request_notification(current_lsn)

    receive do
      {:cached_wal_notification, ^ref, :new_segments_available} -> :ok
    after
      @sleep_timeout ->
        flunk(
          "Timed out while waiting to see #{current_lsn} in CachedWal, with it's position being #{inspect(CachedWal.Api.get_current_position())}"
        )
    end
  end
end
