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
      `async_fun/4`.

    - Adding dynamic attributes to the current span, after it has already started. See
      `add_span_attributes/2`.

    - Recording an error or an exception as a span event. See `record_exception/3`.

  [1]: https://opentelemetry.io/docs/what-is-opentelemetry/
  [2]: https://github.com/open-telemetry/opentelemetry-erlang
  """

  require Logger
  require OpenTelemetry.SemanticConventions.Trace

  @typep span_name :: String.t()
  @typep span_attrs :: :opentelemetry.attributes_map()
  @typep span_ctx :: :opentelemetry.span_ctx()

  defguardp is_exception?(term)
            when is_map(term) and :erlang.is_map_key(:__struct__, term) and
                   is_atom(:erlang.map_get(:__struct__, term)) and
                   :erlang.is_map_key(:__exception__, term) and
                   :erlang.map_get(:__exception__, term) == true

  @doc """
  Create a span that starts at the current point in time and ends when `fun` returns.

  Returns the result of calling the function `fun`.

  Calling this function inside another span establishes a parent-child relationship between
  the two, as long as both calls happen within the same Elixir process. See `async_fun/4` for
  interprocess progragation of span context.
  """
  @spec with_span(span_name(), span_attrs(), (-> t)) :: t when t: term
  def with_span(name, attributes, fun)
      when is_binary(name) and (is_list(attributes) or is_map(attributes)) do
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

    erlang_telemetry_event = [
      :electric | name |> String.split(".", trim: true) |> Enum.map(&String.to_atom/1)
    ]

    :telemetry.span(erlang_telemetry_event, Map.new(attributes), fn ->
      fun_result = :otel_tracer.with_span(tracer(), name, span_opts, fn _span_ctx -> fun.() end)
      {fun_result, %{}}
    end)
  end

  @doc """
  Wrap the given `fun` in an anonymous function, attaching the current process' span context to it.

  If the wrapped function starts a new span in a different Elixir process, the attached span
  context will be used to establish the parent-child relationship between spans across the
  process boundary.
  """
  @spec async_fun(span_ctx() | nil, span_name(), span_attrs(), (-> t)) :: (-> t) when t: term
  def async_fun(span_ctx \\ nil, name, attributes, fun)
      when is_binary(name) and (is_list(attributes) or is_map(attributes)) do
    wrap_fun_with_context(span_ctx, fn -> with_span(name, attributes, fun) end)
  end

  @doc """
  Add dynamic attributes to the current span.

  For example, if a span is started prior to issuing a DB request, an attribute named
  `num_rows_fetched` can be added to it using this function once the DB query returns its
  result.
  """
  @spec add_span_attributes(span_ctx() | nil, span_attrs()) :: boolean()
  def add_span_attributes(span_ctx \\ nil, attributes) do
    span_ctx = span_ctx || get_current_context()
    :otel_span.set_attributes(span_ctx, attributes)
  end

  @doc """
  Add an error event to the current span.
  """
  def record_exception(error, stacktrace \\ nil, attributes \\ []) do
    {type, message} =
      if is_exception?(error) do
        {to_string(error.__struct__), Exception.message(error)}
      else
        {"error", to_string(error)}
      end

    semantic_attributes = [
      {OpenTelemetry.SemanticConventions.Trace.exception_type(), type},
      {OpenTelemetry.SemanticConventions.Trace.exception_message(), message},
      {OpenTelemetry.SemanticConventions.Trace.exception_stacktrace(),
       Exception.format_stacktrace(stacktrace)}
    ]

    :otel_span.add_event(get_current_context(), "exception", semantic_attributes ++ attributes)
  end

  defp tracer, do: :opentelemetry.get_tracer()

  def get_current_context do
    :otel_tracer.current_span_ctx()
  end

  # Set the span on otel_ctx of the current process to `span_ctx`, so that subsequent `with_span()`
  # calls are registered as its child.
  def set_current_context(span_ctx) do
    :otel_tracer.set_current_span(span_ctx)
  end

  defp wrap_fun_with_context(span_ctx, fun) do
    span_ctx = span_ctx || get_current_context()

    fn ->
      set_current_context(span_ctx)
      fun.()
    end
  end
end
