defmodule PgInterop.Postgrex.Extensions.PgSnapshotTest do
  use ExUnit.Case, async: false

  setup do: %{connection_opt_overrides: [pool_size: 4]}
  setup {Support.DbSetup, :with_unique_db}

  test "can decode pg_snapshot values", %{db_conn: db_pool} do
    Postgrex.query!(db_pool, "CREATE TABLE foo(id int PRIMARY KEY)", [])

    # Starting a new transaction, followed by a committed write, results in the growth of the
    # current snapshot's xip_list.
    num_txns = 3

    Enum.each(1..num_txns, fn i ->
      spawn_txn(db_pool)
      Postgrex.query!(db_pool, "INSERT INTO foo VALUES (#{i})", [])
    end)

    {:ok, result} =
      Postgrex.transaction(db_pool, fn conn ->
        Postgrex.query!(conn, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", [])
        Postgrex.query!(conn, "SELECT pg_current_snapshot()", [])
      end)

    assert %Postgrex.Result{rows: [[{xmin, xmax, xip_list}]], num_rows: 1} = result

    assert is_integer(xmin)
    assert xmin > 0
    assert is_integer(xmax)
    assert xmax > 0
    assert xmin < xmax

    assert is_list(xip_list)
    assert Enum.all?(xip_list, &is_integer/1)
    assert Enum.all?(xip_list, &(&1 > 0))

    # Postgres transactions and XIDs are not scoped to any single database. So due to the
    # concurrent nature of our unit tests, the list of active transactions may include some
    # started by other tests running in parallel with this one.
    assert num_txns <= length(xip_list)

    assert xmin in xip_list
    assert Enum.max(xip_list) < xmax
  end

  test "encoding of pg_snapshot values is not implemented", %{db_conn: conn} do
    assert_raise DBConnection.EncodeError,
                 "encoding of type pg_snapshot not implemented",
                 fn ->
                   Postgrex.query(conn, "SELECT $1::pg_snapshot", [{1, 2, [1]}])
                 end
  end

  #
  ## Helper functions
  #

  defp spawn_txn(conn) do
    pid = self()
    ref = make_ref()

    t = Task.async(fn -> Postgrex.transaction(conn, &generic_txn(&1, pid, ref)) end)
    assert_receive {:inside_transaction, ^ref}

    {t, ref}
  end

  defp generic_txn(conn, pid, ref) do
    Postgrex.query!(conn, "SELECT pg_current_xact_id()", [])
    send(pid, {:inside_transaction, ref})

    receive do
      {:shutdown, ^ref} -> :ok
    end
  end
end
