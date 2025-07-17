defmodule Electric.Telemetry.OpenTelemetryTest do
  alias Electric.Telemetry.OpenTelemetry

  use ExUnit.Case
  use Repatch.ExUnit

  @stack_id "the_stack_id"

  test "baggage is propagated to new processes when the context is carried over" do
    OpenTelemetry.with_span("test", %{}, @stack_id, fn ->
      OpenTelemetry.set_in_baggage("some_key", "some_value")

      context = OpenTelemetry.get_current_context()

      Task.async(fn ->
        OpenTelemetry.set_current_context(context)

        assert OpenTelemetry.get_from_baggage("some_key") == "some_value"
      end)
      |> Task.await()
    end)
  end

  describe "with_child_span" do
    test "creates a span if there is a parent span" do
      OpenTelemetry.with_span("parent_span", %{}, @stack_id, fn ->
        Repatch.spy(OpenTelemetry)

        OpenTelemetry.with_child_span("child_span", %{}, @stack_id, fn ->
          :some_code
        end)

        assert Repatch.called?(OpenTelemetry, :with_span, 4)
      end)
    end

    test "does not create a span if there is not a parent span" do
      Repatch.spy(OpenTelemetry)

      OpenTelemetry.with_child_span("child_span", %{}, @stack_id, fn ->
        :some_code
      end)

      refute Repatch.called?(OpenTelemetry, :with_span, 4)
    end
  end
end
