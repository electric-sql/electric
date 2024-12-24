defmodule Electric.TelemetryTest do
  use ExUnit.Case, async: true

  describe "get_system_memory_usage" do
    test "returns calculated memory stats" do
      assert %{
               total_memory: _,
               available_memory: _,
               buffered_memory: _,
               cached_memory: _,
               free_memory: _,
               used_memory: _,
               resident_memory: _,
               total_swap: _,
               free_swap: _,
               used_swap: _
             } = Electric.Telemetry.get_system_memory_usage([])
    end
  end
end
