defmodule Electric.Telemetry.OpenTelemetryTest do
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Telemetry.Sampler

  use ExUnit.Case, async: true
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

  describe "with_span/4" do
    test "creates a OTEL span" do
      Repatch.spy(:otel_tracer)

      OpenTelemetry.with_span("test_span", %{}, @stack_id, fn ->
        :some_code
      end)

      assert Repatch.called?(:otel_tracer, :with_span, 4)
    end

    test "does not create an OTEL span if the samler does not include it" do
      Repatch.spy(:otel_tracer)
      Repatch.patch(Sampler, :include_span?, fn _ -> false end)

      OpenTelemetry.with_span("test_span", %{}, @stack_id, fn ->
        :some_code
      end)

      refute Repatch.called?(:otel_tracer, :with_span, 4)
    end

    test "calls :telemetry.span/3 even if the samler does not include it" do
      pid = self()

      :telemetry.attach(
        pid,
        [:electric, :test_span, :start],
        fn _, _, _, _ -> send(pid, :span_started) end,
        nil
      )

      Repatch.patch(Sampler, :include_span?, fn _ -> false end)

      OpenTelemetry.with_span("test_span", %{}, @stack_id, fn ->
        :some_code
      end)

      assert_receive :span_started
    end
  end

  describe "with_child_span/4" do
    test "creates a span if there is a parent span" do
      OpenTelemetry.with_span("parent_span", %{}, @stack_id, fn ->
        Repatch.spy(:otel_tracer)

        OpenTelemetry.with_child_span("child_span", %{}, @stack_id, fn ->
          :some_code
        end)

        assert Repatch.called?(:otel_tracer, :with_span, 4)
      end)
    end

    test "does not create a span if there is not a parent span" do
      Repatch.spy(:otel_tracer)

      OpenTelemetry.with_child_span("child_span", %{}, @stack_id, fn ->
        :some_code
      end)

      refute Repatch.called?(:otel_tracer, :with_span, 4)
    end
  end
end
