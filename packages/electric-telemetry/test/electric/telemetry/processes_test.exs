defmodule ElectricTelemetry.ProcessesTest do
  use ExUnit.Case, async: true

  describe "top_memory_by_type/[1, 2]" do
    import ElectricTelemetry.Processes, only: [top_memory_by_type: 0, top_memory_by_type: 1]

    test "handles dead processes" do
      parent = self()

      pid1 =
        spawn(fn ->
          receive do
            _ -> send(parent, {:dead, 1})
          end
        end)

      pid2 =
        spawn(fn ->
          receive do
            _ -> send(parent, {:dead, 2})
          end
        end)

      send(pid1, :die)

      assert_receive {:dead, 1}

      refute Process.alive?(pid1)

      assert [%{memory: memory, type: :erlang}] = top_memory_by_type([pid1, pid2])

      assert is_integer(memory)
    end

    test "defaults to top 5 of all processes" do
      assert [
               %{memory: _, type: _},
               %{memory: _, type: _},
               %{memory: _, type: _},
               %{memory: _, type: _},
               %{memory: _, type: _}
             ] = top_memory_by_type()
    end

    test "allows for setting count limit" do
      assert [
               %{memory: _, type: _},
               %{memory: _, type: _}
             ] = top_memory_by_type({:count, 2})
    end

    test "mem_percent returns groups until target is reached" do
      results = top_memory_by_type({:mem_percent, 50})
      assert length(results) >= 1

      total_process_memory = :erlang.memory(:processes_used)
      returned_memory = results |> Enum.map(& &1.memory) |> Enum.sum()

      # Either we hit the 50% target or we ran out of groups above 1MiB
      assert returned_memory >= total_process_memory * 0.5 or
               List.last(results).memory < 1024 * 1024
    end
  end
end
