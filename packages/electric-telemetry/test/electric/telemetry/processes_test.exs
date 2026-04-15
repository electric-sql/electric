defmodule ElectricTelemetry.ProcessesTest do
  use ExUnit.Case, async: true

  import ElectricTelemetry.Processes

  describe "proc_type/1 with binary labels" do
    test "groups request labels by method and path, stripping query and request id" do
      pid = spawn_with_label("Request F-jPUudNHxbD8lIAABQG - GET /v1/shape?table=users&offset=-1")

      assert "GET /v1/shape" = proc_type(pid)
    end

    test "request label without query string keeps full path" do
      pid = spawn_with_label("Request F-jPUudNHxbD8lIAABQG - GET /v1/health")

      assert "GET /v1/health" = proc_type(pid)
    end

    test "non-request binary labels are truncated to 20 chars" do
      pid = spawn_with_label("some_long_label_that_exceeds_twenty_characters")

      assert "some_long_label_that" = proc_type(pid)
    end

    test "short non-request binary labels are kept as-is" do
      pid = spawn_with_label("short_label")

      assert "short_label" = proc_type(pid)
    end
  end

  describe "proc_type/1 with tuple labels" do
    test "two-element tuple label returns first element" do
      pid = spawn_with_label({:my_worker, "extra_info"})
      assert :my_worker = proc_type(pid)
    end

    test "three-element tuple label returns first element" do
      pid = spawn_with_label({:my_handler, :some_ref, 42})
      assert :my_handler = proc_type(pid)
    end
  end

  describe "proc_type/1 with atom labels" do
    test "atom label is returned as-is" do
      pid = spawn_with_label(:my_process)
      assert :my_process = proc_type(pid)
    end
  end

  describe "proc_type/1 with unsupported label types" do
    test "integer label falls back to initial call module" do
      pid = spawn_with_label(12345)
      assert :erlang = proc_type(pid)
    end

    test "list label falls back to initial call module" do
      pid = spawn_with_label([1, 2, 3])
      assert :erlang = proc_type(pid)
    end

    test "four-element tuple falls back to initial call module" do
      pid = spawn_with_label({:a, :b, :c, :d})
      assert :erlang = proc_type(pid)
    end
  end

  describe "proc_type/1 without labels (initial call fallback)" do
    test "returns module from $initial_call in process dictionary" do
      parent = self()

      pid =
        spawn_link(fn ->
          Process.put(:"$initial_call", {MyApp.Worker, :init, 1})
          send(parent, :ready)
          Process.sleep(:infinity)
        end)

      assert_receive :ready

      # initial_call info would be {:erlang, :apply, 2} for a spawned process,
      # but $initial_call in the dictionary takes precedence
      assert MyApp.Worker = proc_type(pid)
    end

    test "returns module from initial_call info when no $initial_call" do
      pid =
        spawn_link(fn ->
          :ok
          Process.sleep(:infinity)
        end)

      assert :erlang = proc_type(pid)

      pid =
        :proc_lib.spawn_link(fn ->
          :ok
          Process.sleep(:infinity)
        end)

      assert :proc_lib = proc_type(pid)
    end
  end

  describe "proc_type/1 for dead processes" do
    test "returns :dead for a process that has exited" do
      pid =
        spawn_link(fn ->
          receive do
            :die -> :ok
          end
        end)

      ref = Process.monitor(pid)
      send(pid, :die)

      assert_receive {:DOWN, ^ref, :process, ^pid, :normal}
      assert :dead = proc_type(pid)
    end
  end

  describe "top_memory_by_type/[1, 2]" do
    test "handles dead processes" do
      parent = self()

      pid1 =
        spawn_link(fn ->
          receive do
            _ -> send(parent, {:dead, 1})
          end
        end)

      pid2 =
        spawn_link(fn ->
          receive do
            _ -> send(parent, {:dead, 2})
          end
        end)

      send(pid1, :die)

      assert_receive {:dead, 1}

      refute Process.alive?(pid1)

      assert [
               %{
                 proc_mem: memory,
                 binary_mem: _,
                 avg_bin_count: _,
                 avg_ref_count: _,
                 type: :erlang
               }
             ] = top_memory_by_type([pid1, pid2])

      assert is_integer(memory)
    end

    test "defaults to top 5 of all processes" do
      assert [
               %{proc_mem: _, type: _},
               %{proc_mem: _, type: _},
               %{proc_mem: _, type: _},
               %{proc_mem: _, type: _},
               %{proc_mem: _, type: _}
             ] = top_memory_by_type()
    end

    test "allows for setting count limit" do
      assert [
               %{proc_mem: _, type: _},
               %{proc_mem: _, type: _}
             ] = top_memory_by_type({:count, 2})
    end

    test "mem_percent returns groups until target is reached" do
      :ok =
        [{:large, 10 * 1024 * 1024}, {:medium, 2 * 1024 * 1024}, {:small, 100}]
        |> Enum.each(fn {label, size} ->
          spawn_with_label(label, fn -> Process.put(:str, String.duplicate(".", size)) end)
        end)

      results = top_memory_by_type({:mem_percent, 50})
      assert length(results) >= 1

      total_process_memory = :erlang.memory(:processes_used)
      returned_memory = results |> Enum.map(& &1.proc_mem) |> Enum.sum()

      # Either we hit the 50% target or we ran out of groups above 1MiB
      assert returned_memory >= total_process_memory * 0.5 or
               List.last(results).proc_mem < 1024 * 1024
    end
  end

  describe "top_bin_memory_by_type/[0, 1, 2]" do
    test "defaults to top 5 sorted by binary_mem" do
      results = top_bin_memory_by_type()
      assert length(results) == 5
      binary_mems = Enum.map(results, & &1.binary_mem)
      assert binary_mems == Enum.sort(binary_mems, :desc)
    end

    test "sorts by binary_mem, not proc_mem" do
      # Spawn a process with large binary memory but small heap
      spawn_with_label(:big_binary, fn ->
        Process.put(:bin, :crypto.strong_rand_bytes(2 * 1024 * 1024))
      end)

      # Spawn a process with large heap but no binary memory
      spawn_with_label(:big_heap, fn ->
        Process.put(:list, Enum.to_list(1..200_000))
      end)

      proc_mem_results = top_memory_by_type({:count, 100})
      bin_mem_results = top_bin_memory_by_type({:count, 100})

      # Each list is sorted by its own key
      proc_mems = Enum.map(proc_mem_results, & &1.proc_mem)
      assert proc_mems == Enum.sort(proc_mems, :desc)

      binary_mems = Enum.map(bin_mem_results, & &1.binary_mem)
      assert binary_mems == Enum.sort(binary_mems, :desc)

      # The top entry in each list should be different
      assert hd(proc_mem_results).type != hd(bin_mem_results).type
    end

    test "at_least_bytes stops at the cutoff" do
      spawn_with_label(:bin_large, fn ->
        Process.put(:bin, :crypto.strong_rand_bytes(2 * 1024 * 1024))
      end)

      spawn_with_label(:bin_small, fn ->
        Process.put(:bin, :crypto.strong_rand_bytes(100))
      end)

      results = top_bin_memory_by_type({:at_least_bytes, 1024 * 1024})

      # The last entry should be the one that fell below the cutoff
      last = List.last(results)
      above_cutoff = Enum.drop(results, -1)

      assert Enum.all?(above_cutoff, &(&1.binary_mem >= 1024 * 1024))
      assert last.binary_mem < 1024 * 1024
    end

    test "at_least_bytes with process list" do
      pid1 =
        spawn_with_label(:with_bin, fn ->
          Process.put(:bin, :crypto.strong_rand_bytes(512 * 1024))
        end)

      pid2 =
        spawn_with_label(:without_bin, fn ->
          :ok
        end)

      results = top_bin_memory_by_type([pid1, pid2], {:at_least_bytes, 1024})

      types = Enum.map(results, & &1.type)
      assert :with_bin in types
    end
  end

  defp spawn_with_label(label, fun \\ fn -> nil end) do
    parent = self()

    pid =
      spawn_link(fn ->
        fun.()
        Process.set_label(label)
        send(parent, :labelled)
        Process.sleep(:infinity)
      end)

    assert_receive :labelled, 150
    pid
  end
end
