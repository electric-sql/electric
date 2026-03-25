defmodule ElectricTelemetry.ProcessesTest do
  use ExUnit.Case, async: true

  describe "proc_type/1 with binary labels" do
    import ElectricTelemetry.Processes, only: [proc_type: 1]

    defp spawn_with_label(label) do
      parent = self()

      pid =
        spawn(fn ->
          Process.set_label(label)
          send(parent, :labelled)
          Process.sleep(:infinity)
        end)

      assert_receive :labelled
      pid
    end

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
