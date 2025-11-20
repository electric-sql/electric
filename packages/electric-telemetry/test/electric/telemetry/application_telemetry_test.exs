defmodule ElectricTelemetry.ApplicationTelemetryTest do
  use ExUnit.Case, async: true

  alias ElectricTelemetry.ApplicationTelemetry

  describe "get_system_memory_usage" do
    test "returns calculated memory stats" do
      case :os.type() do
        {:unix, :darwin} ->
          assert %{
                   total_memory: _,
                   available_memory: _,
                   free_memory: _,
                   used_memory: _,
                   resident_memory: _
                 } = ApplicationTelemetry.get_system_memory_usage(%{})

        _ ->
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
                 } = ApplicationTelemetry.get_system_memory_usage(%{})
      end
    end
  end
end
