defmodule Electric.Replication.ElectrificationTest do
  use ExUnit.Case, async: false

  import Electric.Postgres.TestConnection

  alias Electric.Postgres.CachedWal
  alias Electric.Replication.Changes.{Migration, Transaction}

  @origin "electrification-test"
  @sleep_timeout 5000

  setup ctx, do: Map.put(ctx, :origin, @origin)
  setup :setup_replicated_db

  test "electrify() on existing table propagates through to CachedWal", %{
    conn: conn,
    origin: origin
  } do
    lsn = CachedWal.Api.get_current_position(origin)

    assert :ok == create_test_table(conn)

    assert {:ok, lsn,
            %Transaction{
              changes: [
                %Migration{
                  relation: {"electric", "ddl_commands"},
                  ddl: [
                    "CREATE TABLE foo (\n    id text NOT NULL,\n    CONSTRAINT foo_pkey PRIMARY KEY (id)\n);\n\n\n"
                  ]
                }
              ],
              origin: @origin
            }} = wait_for_next_cached_wal_tx(origin, lsn)

    assert :timeout == wait_for_next_cached_wal_tx(origin, lsn)
  end

  test "electrify() on non-existing table does not propagate", %{conn: conn, origin: origin} do
    lsn = CachedWal.Api.get_current_position(origin)

    assert {:error,
            {:error, :error, _, :undefined_table, "relation \"public.nil\" does not exist", _}} =
             :epgsql.squery(conn, "CALL electric.electrify('public.nil')")

    assert :timeout == wait_for_next_cached_wal_tx(origin, lsn)
  end

  test "electrify() on already electrified table does not propagate", %{
    conn: conn,
    origin: origin
  } do
    lsn = CachedWal.Api.get_current_position(origin)

    assert :ok == create_test_table(conn)

    assert {:ok, lsn,
            %Transaction{
              changes: [
                %Migration{
                  relation: {"electric", "ddl_commands"},
                  ddl: [
                    "CREATE TABLE foo (\n    id text NOT NULL,\n    CONSTRAINT foo_pkey PRIMARY KEY (id)\n);\n\n\n"
                  ]
                }
              ],
              origin: @origin
            }} = wait_for_next_cached_wal_tx(origin, lsn)

    # Try electrifying the table again
    assert {:ok, [], []} = :epgsql.squery(conn, "CALL electric.electrify('public.foo')")

    # Assert that it doesn't propagate the 2nd time around
    assert :timeout == wait_for_next_cached_wal_tx(origin, lsn)
  end

  defp create_test_table(conn) do
    assert [{:ok, [], []}, {:ok, [], []}, {:ok, [], []}, {:ok, [], []}, {:ok, [], []}] =
             :epgsql.squery(conn, """
             BEGIN;
             CALL electric.migration_version('20230830173206');
             CREATE TABLE public.foo (id TEXT PRIMARY KEY);
             CALL electric.electrify('public.foo');
             COMMIT;
             """)

    :ok
  end

  defp wait_for_next_cached_wal_tx(origin, lsn) do
    with :ok <- wait_until_cached_wal_advances(origin, lsn),
         {:ok, %Transaction{changes: [_ | _]} = tx, new_lsn} <-
           CachedWal.Api.next_segment(origin, lsn) do
      {:ok, new_lsn, tx}
    else
      {:ok, %Transaction{changes: []}, new_lsn} -> wait_for_next_cached_wal_tx(origin, new_lsn)
      :timeout -> :timeout
    end
  end

  defp wait_until_cached_wal_advances(origin, lsn) do
    {:ok, ref} = CachedWal.Api.request_notification(origin, lsn)

    receive do
      {:cached_wal_notification, ^ref, :new_segments_available} ->
        :ok
    after
      @sleep_timeout -> :timeout
    end
  end
end
