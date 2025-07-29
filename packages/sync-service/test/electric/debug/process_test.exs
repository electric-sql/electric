defmodule Electric.Debug.ProcessTest do
  use ExUnit.Case, async: true

  describe "top_memory_by_type/[1, 2]" do
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

      assert [%{memory: memory, type: :erlang}] =
               Electric.Debug.Process.top_memory_by_type([pid1, pid2])

      assert is_integer(memory)
    end

    test "defaults to top 5 of all processes" do
      assert [
               %{memory: _, type: _},
               %{memory: _, type: _},
               %{memory: _, type: _},
               %{memory: _, type: _},
               %{memory: _, type: _}
             ] = Electric.Debug.Process.top_memory_by_type()
    end

    test "allows for setting limit" do
      assert [
               %{memory: _, type: _},
               %{memory: _, type: _}
             ] = Electric.Debug.Process.top_memory_by_type(2)
    end
  end

  describe "top_reduction_rate_per_type/1" do
    test "works" do
      start_busy_process({:p1, 1}, 10)
      start_busy_process({:p2, 1}, 50)
      start_busy_process({:p3, 1}, 90)

      assert [
               %{type: :p3, reduction_rate: _},
               %{type: :p2, reduction_rate: _},
               %{type: :p1, reduction_rate: _}
             ] = Electric.Debug.Process.top_reduction_rate_per_type(3)
    end

    defp start_busy_process(lable, load_percent) do
      Task.async(fn ->
        Process.set_label(lable)
        busy_loop(load_percent, System.monotonic_time(:microsecond))
      end)
    end

    defp busy_loop(reduction_rate, start_time) do
      1..1000 |> Enum.each(fn _ -> :ok end)
      {:reductions, reductions} = Process.info(self(), :reductions)
      time = System.monotonic_time(:microsecond) - start_time
      actual_reduction_rate = reductions / time

      if actual_reduction_rate > reduction_rate do
        Process.sleep(1)
        busy_loop(reduction_rate, start_time)
      else
        busy_loop(reduction_rate, start_time)
      end
    end
  end
end
