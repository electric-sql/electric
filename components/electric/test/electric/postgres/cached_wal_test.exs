defmodule Electric.Postgres.CachedWalTest do
  use ExUnit.Case

  alias Electric.Postgres.CachedWal.WalMng

  setup(_) do
    {:ok, pid} = WalMng.start_link(quota: 3, seg_limit: 2)

    on_exit(fn ->
      mon_ref = Process.monitor(pid)
      Process.exit(pid, :shutdown)

      receive do
        {:DOWN, ^mon_ref, :process, ^pid, _} ->
          :ok
      end
    end)

    {:ok, %{pid: pid}}
  end

  test "simple subscription flow", %{pid: pid} do
    :ok = WalMng.subscribe_client(pid)
    :ok = WalMng.unsubscribe_client(pid)
  end

  test "simple subscription flow + lsn", %{pid: pid} do
    {:error, :no_active_segment} = WalMng.get_current_segment(pid)
    {:ok, segment} = WalMng.allocate_new_segment(pid, 10)

    :ok = WalMng.write_to_segment(segment, _lsn = 10, :my_10)
    :ok = WalMng.write_to_segment(segment, _lsn = 20, :my_20)

    # Lsns are not supposed to go backwards
    assert_raise RuntimeError, fn ->
      WalMng.write_to_segment(segment, _lsn = 19, :my_faulty_lsn)
    end

    :ok = WalMng.write_to_segment(segment, _lsn = 30, :my_30)

    {:error, :quota_limit} = WalMng.write_to_segment(segment, _lsn = 40, :my_40)
  end

  test "Push to segment with automatic segment allocation", %{pid: pid} do
    {:error, :no_active_segment} = WalMng.get_current_segment(pid)
    {:ok, segment} = WalMng.allocate_new_segment(pid, 10)

    {:ok, segment} = WalMng.push_to_segment(pid, segment, _lsn = 10, :my_10)
    {:ok, segment} = WalMng.push_to_segment(pid, segment, _lsn = 20, :my_20)
    {:ok, segment} = WalMng.push_to_segment(pid, segment, _lsn = 30, :my_30)
    {:ok, _segment} = WalMng.push_to_segment(pid, segment, _lsn = 40, :my_40)
  end

  test "Push to segment with automatic segment allocation and GC", %{pid: pid} do
    {:error, :no_active_segment} = WalMng.get_current_segment(pid)
    {:ok, segment} = WalMng.allocate_new_segment(pid, 1)

    push_to_segment(pid, Enum.to_list(1..100), segment)

    assert 2 == WalMng.get_segments_count()
  end

  test "Simple writes/reads test", %{pid: pid} do
    # Init cached wal with some data
    {:ok, segment} = WalMng.allocate_new_segment(pid, 1)

    segment = push_to_segment(pid, Enum.to_list(1..100), segment)

    :ok = WalMng.subscribe_client(pid)
    {:error, :stale_lsn} = WalMng.get_iter(10)
    :ok = WalMng.unsubscribe_client(pid)

    :ok = WalMng.subscribe_client(pid)
    {:await, iter} = WalMng.get_iter(110)
    {:await, iter} = WalMng.get_next(iter)

    {:ok, ref} = WalMng.get_await(iter)

    # Iter is still set on the segment, which has last lsn = 100 after adding
    # more data, the segment is goin to be garbage collected, so the code should
    # be able to swtich to a new segment
    push_to_segment(pid, Enum.to_list(101..111), segment)

    assert_receive {:wal_ready, ^ref}

    {:ok, 111, _iter} = WalMng.get_next(iter)
    :ok = WalMng.unsubscribe_client(pid)
  end

  def push_to_segment(pid, list, segment) do
    Enum.reduce(list, segment, fn lsn, segment ->
      {:ok, segment} = WalMng.push_to_segment(pid, segment, lsn, lsn)
      segment
    end)
  end
end
