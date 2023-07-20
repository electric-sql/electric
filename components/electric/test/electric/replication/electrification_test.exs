defmodule Electric.Replication.ElectrificationTest do
  use ExUnit.Case, async: false

  import Electric.Postgres.TestConnection

  alias Electric.Postgres.CachedWal
  alias Electric.Replication.Changes.{NewRecord, Transaction}

  @origin "electrification-test"
  @sleep_timeout 5000

  setup ctx, do: Map.put(ctx, :origin, @origin)
  setup :setup_replicated_db

  test "electrify() on existing table propagates through to CachedWal", %{conn: conn} do
    lsn = CachedWal.Api.get_current_position()

    assert :ok == create_test_table(conn)

    assert {:ok, lsn,
            %Transaction{
              changes: [
                %NewRecord{
                  relation: {"electric", "ddl_commands"},
                  record: %{
                    "query" =>
                      "CREATE TABLE foo (\n    id text NOT NULL,\n    CONSTRAINT foo_pkey PRIMARY KEY (id)\n);\n\n\n"
                  }
                }
              ],
              origin: @origin
            }} = wait_for_next_cached_wal_tx(lsn)

    assert :timeout == wait_for_next_cached_wal_tx(lsn)
  end

  test "electrify() on non-existing table does not propagate", %{conn: conn} do
    lsn = CachedWal.Api.get_current_position()

    assert {:error,
            {:error, :error, _, :undefined_table, "relation \"public.nil\" does not exist", _}} =
             :epgsql.squery(conn, "CALL electric.electrify('public.nil')")

    assert :timeout == wait_for_next_cached_wal_tx(lsn)
  end

  test "electrify() on already electrified table does not propagate", %{conn: conn} do
    lsn = CachedWal.Api.get_current_position()

    assert :ok == create_test_table(conn)

    assert {:ok, lsn,
            %Transaction{
              changes: [
                %NewRecord{
                  relation: {"electric", "ddl_commands"},
                  record: %{
                    "query" =>
                      "CREATE TABLE foo (\n    id text NOT NULL,\n    CONSTRAINT foo_pkey PRIMARY KEY (id)\n);\n\n\n"
                  }
                }
              ],
              origin: @origin
            }} = wait_for_next_cached_wal_tx(lsn)

    # Try electrifying the table again
    assert {:error,
            {:error, :error, _, :raise_exception, "table public.foo is already electrified", _}} =
             :epgsql.squery(conn, "CALL electric.electrify('public.foo')")

    # Assert that it doesn't propagate the 2nd time around
    assert :timeout == wait_for_next_cached_wal_tx(lsn)
  end

  defp create_test_table(conn) do
    assert [{:ok, [], []}, {:ok, [], []}, {:ok, [], []}, {:ok, [], []}] =
             :epgsql.squery(conn, """
             BEGIN;
             CREATE TABLE public.foo (id TEXT PRIMARY KEY);
             CALL electric.electrify('public.foo');
             COMMIT;
             """)

    :ok
  end

  defp wait_for_next_cached_wal_tx(lsn) do
    with :ok <- wait_until_cached_wal_advances(lsn),
         {:ok, %Transaction{changes: [_ | _]} = tx, new_lsn} <- CachedWal.Api.next_segment(lsn) do
      {:ok, new_lsn, tx}
    else
      {:ok, %Transaction{changes: []}, new_lsn} -> wait_for_next_cached_wal_tx(new_lsn)
      :timeout -> :timeout
    end
  end

  defp wait_until_cached_wal_advances(lsn) do
    {:ok, ref} = CachedWal.Api.request_notification(lsn)

    receive do
      {:cached_wal_notification, ^ref, :new_segments_available} ->
        :ok
    after
      @sleep_timeout -> :timeout
    end
  end
end
