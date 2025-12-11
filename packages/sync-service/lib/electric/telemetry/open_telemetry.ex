defmodule Electric.Telemetry.OpenTelemetry do
  @moduledoc """
  This module implements an API to cover parts of the code with tracing spans that are then
  exported using the OpenTelemetry protocol.

  [OpenTelemetry][1] is an observability framework that is widely supported by observability tools.

  This module's implementation is based on the [opentelemetry-erlang][2] suite of libraries.
  There is a rudimentary Elixir API there but it's incomplete and non-idiomatic. The idea with
  this module is to expose all of the functionality we're using in our code by wrapping
  opentelemetry-erlang's API.

  The configuration for OpenTelemetry export is located in `config/runtime.exs`.

  The API implemented here so far includes support for:

    - Defining a span to cover the execution of a piece of code. See `with_span/3`.

    - Propagating span context across Elixir processes, to allow for a span started in one
      process to be registered as a parent of a span started in a different process. See
      `get_current_context/1` and `set_current_context/1`.

    - Adding dynamic attributes to the current span, after it has already started. See
      `add_span_attributes/2`.

    - Recording an error or an exception as a span event. See `record_exception/4`.

  [1]: https://opentelemetry.io/docs/what-is-opentelemetry/
  [2]: https://github.com/open-telemetry/opentelemetry-erlang
  """

  alias Electric.Telemetry.Sampler
  alias Electric.Telemetry.IntervalTimer

  @typep span_name :: String.t()
  @typep attr_name :: String.t()
  @typep span_attrs :: :opentelemetry.attributes_map()
  @typep span_ctx :: :opentelemetry.span_ctx()

  @doc """
  Create a span that starts at the current point in time and ends when `fun` returns.

  Returns the result of calling the function `fun`.

  Calling this function inside another span establishes a parent-child relationship between
  the two, as long as both calls happen within the same Elixir process. Use `get_current_context/1` for
  interprocess progragation of span context.

  The `stack_id` parameter must be set in root spans. For child spans the stack_id is optional
  and will be inherited from the parent span.
  """
  @spec with_span(span_name(), span_attrs(), String.t() | nil, (-> t)) :: t when t: term
  def with_span(name, attributes, stack_id \\ nil, fun)
      when is_binary(name) and (is_list(attributes) or is_map(attributes)) do
    do_with_span(name, attributes, stack_id, fun, Sampler.include_span?(name))
  end

  @doc """
  Creates a span providing there is a parent span in the current context.
  If there is no parent span, the function `fun` is called without creating a span.

  This is necessary for the custom way we do sampling, if the parent span is not sampled, the child span
  will not be created either.
  """
  def with_child_span(name, attributes, stack_id \\ nil, fun) do
    do_with_span(
      name,
      attributes,
      stack_id,
      fun,
      in_span_context?() && Sampler.include_span?(name)
    )
  end

  defp do_with_span(name, attributes, stack_id, fun, include_otel_span?) do
    erlang_telemetry_event = [
      :electric | name |> String.split(".", trim: true) |> Enum.map(&String.to_atom/1)
    ]

    stack_id = stack_id || get_from_baggage("stack_id")
    stack_attributes = get_stack_span_attrs(stack_id)
    all_attributes = stack_attributes |> Map.merge(Map.new(attributes))

    :telemetry.span(erlang_telemetry_event, all_attributes, fn ->
      fun_result =
        if include_otel_span? do
          with_otel_span(name, all_attributes, stack_id, fun)
        else
          fun.()
        end

      {fun_result, %{}}
    end)
  end

  defp with_otel_span(name, attributes, stack_id, fun) do
    # This map is populated with default values that `:otel_tracer.with_span()` whould have set
    # anyway. But we're forced to do it here to avoid having like 50% of our code covered with
    # Dialyzer warnings (I dare you to try and only leave the `attributes` key here).
    span_opts = %{
      attributes: attributes,
      links: [],
      is_recording: true,
      start_time: :opentelemetry.timestamp(),
      kind: :internal
    }

    set_in_baggage("stack_id", stack_id)

    :otel_tracer.with_span(tracer(), name, span_opts, fn _span_ctx -> fun.() end)
  end

  @doc """
  A thin wrapper around `:telemetry.execute/3` that adds the span attributes for the current
  stack to the metadata.
  """
  @spec execute(
          :telemetry.event_name(),
          :telemetry.event_measurements() | :telemetry.event_value(),
          :telemetry.event_metadata()
        ) :: :ok
  def execute(event_name, measurements, metadata) do
    stack_id = metadata[:stack_id] || get_from_baggage("stack_id")
    metadata = Map.merge(metadata, get_stack_span_attrs(stack_id))
    :telemetry.execute(event_name, measurements, metadata)
  end

  @doc """
  Executes the provided function and records its duration in microseconds.
  The duration is added to the current span as a span attribute named with the given `name`.
  """
  @spec timed_fun(span_ctx() | nil, attr_name(), (-> term)) :: term
  def timed_fun(span_ctx \\ nil, name, fun) when is_binary(name) do
    {duration, result} = :timer.tc(fun)
    add_span_attributes(span_ctx, %{name => duration})
    result
  end

  @doc """
  Add dynamic attributes to the current span.

  For example, if a span is started prior to issuing a DB request, an attribute named
  `num_rows_fetched` can be added to it using this function once the DB query returns its
  result.
  """
  @spec add_span_attributes(span_ctx() | nil, span_attrs()) :: boolean()
  def add_span_attributes(span_ctx \\ nil, attributes) do
    span_ctx = span_ctx || current_span_context()
    :otel_span.set_attributes(span_ctx, attributes)
  end

  @doc """
  Store the telemetry span attributes in the persistent term for this stack.
  """
  @spec set_stack_span_attrs(String.t(), span_attrs()) :: :ok
  def set_stack_span_attrs(stack_id, attrs) do
    :persistent_term.put(:"electric_otel_attributes_#{stack_id}", Map.new(attrs))
  end

  @doc """
  Retrieve the telemetry span attributes from the persistent term for this stack.
  """
  @spec get_stack_span_attrs(String.t()) :: map()
  def get_stack_span_attrs(stack_id) do
    :persistent_term.get(:"electric_otel_attributes_#{stack_id}", %{})
  end

  @doc """
  Records that an interval with the given `interval_name` has started.

  This is useful if you want to find out which part of a process took
  the longest time. It works out simpler than wrapping each part of
  the process in a timer, and guarentees no gaps in the timings.

  Once a number of intervals have been started, call
  `stop_and_save_intervals()` to record the interval timings as
  attributes in the current span.

  e.g.

  ```elixir
  OpenTelemetry.start_interval(:quick_sleep.duration_µs)
  Process.sleep(1)
  OpenTelemetry.start_interval(:longer_sleep.duration_µs)
  Process.sleep(2)
  OpenTelemetry.stop_and_save_intervals(total_attribute: "total_sleep_µs")
  ```
  will add the following attributes to the current span:
    quick_sleep.duration_µs: 1000
    longer_sleep.duration_µs: 2000
    total_sleep_µs: 3000
  """
  @spec start_interval(atom()) :: :ok
  def start_interval(interval_name) when is_atom(interval_name) do
    IntervalTimer.start_interval(get_interval_timer(), interval_name)
    |> set_interval_timer()

    :ok
  end

  @doc """
  Records the interval timings as attributes in the current span
  and wipes the interval timer from process memory.

  Options:
  - `:timer` - the interval timer to use. If not provided, the timer
    is extracted from the process memory.
  - `:total_attribute` - the name of the attribute to store the total
    time across all intervals. If not provided no total time is recorded.
  """
  def stop_and_save_intervals(opts) do
    timer = opts[:timer] || extract_interval_timer()
    durations = IntervalTimer.durations(timer)

    total_attribute =
      case opts[:total_attribute] do
        nil -> []
        attr_name -> [{attr_name, IntervalTimer.total_time(durations)}]
      end

    add_span_attributes(
      total_attribute ++
        for {interval_name, duration} <- durations do
          {interval_name, duration}
        end
    )
  end

  @interval_timer_key :electric_otel_interval_timer

  @doc """
  Set the interval timer for the current process.
  """
  @spec set_interval_timer(IntervalTimer.t()) :: :ok
  def set_interval_timer(timer) do
    Process.put(@interval_timer_key, timer)
  end

  @doc """
  Wipe the current interval timer from process memory.
  """
  def wipe_interval_timer do
    Process.delete(@interval_timer_key)
  end

  @doc """
  Removes the current interval timer from prcess memory and returns it.

  Useful if you want to time intervals over multiple processes,
  extract the timer, pass it to another process, and then
  use `set_interval_timer/1` to restore it in the new process.
  """
  @spec extract_interval_timer() :: IntervalTimer.t()
  def extract_interval_timer do
    timer = get_interval_timer()
    wipe_interval_timer()
    timer
  end

  defp get_interval_timer do
    Process.get(@interval_timer_key, [])
  end

  @doc """
  Add an error event to the current span.
  """
  def record_exception(error_str, attributes \\ []) when is_binary(error_str) do
    add_exception_event("error", error_str, nil, attributes)
  end

  def record_exception(kind, error, stacktrace, attributes \\ []) when is_atom(kind) do
    type =
      if is_struct(error) do
        to_string(error.__struct__)
      else
        "error"
      end

    message = Exception.format(kind, error)
    add_exception_event(type, message, stacktrace, attributes)
  end

  defp add_exception_event(type, message, stacktrace, attributes) do
    semantic_attributes = [
      {OpenTelemetry.SemConv.ExceptionAttributes.exception_type(), type},
      {OpenTelemetry.SemConv.ExceptionAttributes.exception_message(), message},
      {OpenTelemetry.SemConv.ExceptionAttributes.exception_stacktrace(),
       Exception.format_stacktrace(stacktrace)}
    ]

    ctx = current_span_context()
    :otel_span.add_event(ctx, "exception", semantic_attributes ++ attributes)
    :otel_span.set_status(ctx, :error, message)
  end

  defp tracer, do: :opentelemetry.get_tracer()

  # Get the span and baggage context for the current process
  # Use this to pass the context to another process, see `set_current_context/1`
  def get_current_context do
    {current_span_context(), :otel_baggage.get_all()}
  end

  # Set the span and baggage context for the current process
  def set_current_context({span_ctx, baggage}) do
    :otel_tracer.set_current_span(span_ctx)
    :otel_baggage.set(baggage)
  end

  def set_in_baggage(key, value) do
    :otel_baggage.set(key, value)
  end

  def get_from_baggage(key) do
    case :otel_baggage.get_all() do
      %{^key => {value, _metadata}} -> value
      _ -> nil
    end
  end

  defp current_span_context do
    :otel_tracer.current_span_ctx()
  end

  defp in_span_context? do
    current_span_context() != :undefined
  end
end
