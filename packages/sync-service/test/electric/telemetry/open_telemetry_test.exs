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

    test "calls :telemetry.span/3 even if there is not a parent span" do
      pid = self()

      :telemetry.attach(
        pid,
        [:electric, :child_span, :start],
        fn _, _, _, _ -> send(pid, :span_started) end,
        nil
      )

      OpenTelemetry.with_child_span("child_span", %{}, @stack_id, fn ->
        :some_code
      end)

      assert_receive :span_started
    end

    test "does not create a span if the sampler does not include the child span" do
      OpenTelemetry.with_span("parent_span", %{}, @stack_id, fn ->
        Repatch.spy(:otel_tracer)

        Repatch.patch(Sampler, :include_span?, fn _ -> false end)

        OpenTelemetry.with_child_span("child_span", %{}, @stack_id, fn ->
          :some_code
        end)

        refute Repatch.called?(:otel_tracer, :with_span, 4)
      end)
    end
  end

  describe "process_memory_attributes/1" do
    test "returns process and binary memory for :start phase" do
      attrs = OpenTelemetry.process_memory_attributes(:start)

      assert %{
               "memory.start.process_bytes" => process_bytes,
               "memory.start.binary_bytes" => binary_bytes
             } = attrs

      assert is_integer(process_bytes) and process_bytes > 0
      assert is_integer(binary_bytes) and binary_bytes >= 0
    end

    test "returns process and binary memory for :end phase" do
      attrs = OpenTelemetry.process_memory_attributes(:end)

      assert %{
               "memory.end.process_bytes" => process_bytes,
               "memory.end.binary_bytes" => binary_bytes
             } = attrs

      assert is_integer(process_bytes) and process_bytes > 0
      assert is_integer(binary_bytes) and binary_bytes >= 0
    end

    test "rejects phase values other than :start or :end" do
      assert_raise FunctionClauseError, fn ->
        OpenTelemetry.process_memory_attributes(nil)
      end

      assert_raise FunctionClauseError, fn ->
        OpenTelemetry.process_memory_attributes("start")
      end
    end
  end

  describe "add_process_memory_attributes/1" do
    test "forwards memory attributes through set_attributes on the current span" do
      test_pid = self()

      Repatch.patch(:otel_span, :set_attributes, fn ctx, attrs ->
        send(test_pid, {:set_attributes, attrs})
        Repatch.real(:otel_span, :set_attributes, [ctx, attrs])
      end)

      OpenTelemetry.with_span("test_span", %{}, @stack_id, fn ->
        OpenTelemetry.add_process_memory_attributes(:start)
      end)

      assert_received {:set_attributes,
                       %{
                         "memory.start.process_bytes" => process_bytes,
                         "memory.start.binary_bytes" => binary_bytes
                       }}

      assert is_integer(process_bytes) and process_bytes > 0
      assert is_integer(binary_bytes) and binary_bytes >= 0
    end

    test "is safe to call outside any span" do
      # No surrounding with_span — current_span_context/0 returns the
      # undefined sentinel; :otel_span.set_attributes/2 accepts it and
      # the helper should not raise.
      assert OpenTelemetry.add_process_memory_attributes(:start) in [true, false]
    end
  end
end
