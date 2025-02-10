defmodule Electric.Telemetry.OpenTelemetryTest do
  alias Electric.Telemetry.OpenTelemetry

  use ExUnit.Case

  test "baggage is propagated to new processes when the context is carried over" do
    OpenTelemetry.with_span("test", %{}, "stack_id", fn ->
      OpenTelemetry.set_in_baggage("some_key", "some_value")

      context = OpenTelemetry.get_current_context()

      Task.async(fn ->
        OpenTelemetry.set_current_context(context)

        assert OpenTelemetry.get_from_baggage("some_key") == "some_value"
      end)
      |> Task.await()
    end)
  end
end
