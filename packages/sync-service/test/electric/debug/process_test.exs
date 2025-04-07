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
end
