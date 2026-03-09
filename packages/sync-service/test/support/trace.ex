defmodule Support.Trace do
  @moduledoc """
  Helper module that can be used to trace function calls in tests.

  It is implemented with Erlang's :trace sessions, ensuring isolated tracing between
  concurrently running tests.

  This is a less intrusive and more faithful approach of ensuring certain functions are
  called in tests compared to using wrapper modules or ad-hoc function patching with Repatch.
  """

  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache.Storage

  @doc """
  Enable tracing of function calls for the given module/function/arity combinations.

  Takes a list of trace specs and options. Each trace spec can be:

    - `{Module, function_name, arity}` - trace a specific function
    - `{Module, function_name}` - trace all arities of a function
    - `Module` - trace all functions in the module

  Options:

    - `pid: <pid>` - trace this process instead of self()

  Returns the trace session.
  """
  def trace_calls(trace_specs, opts \\ []) do
    session = :trace.session_create(__MODULE__, self(), [])

    ExUnit.Callbacks.on_exit(fn ->
      :trace.session_destroy(session)
    end)

    traced_pid = opts[:pid] || self()
    :trace.process(session, traced_pid, true, [:call])

    what_to_trace =
      Enum.map(List.wrap(trace_specs), fn
        {mod, name, arity} -> {mod, name, arity}
        {mod, name} when is_atom(mod) and is_atom(name) -> {mod, name, :_}
        mod when is_atom(mod) -> {mod, :_, :_}
      end)

    Enum.each(what_to_trace, &:trace.function(session, &1, true, [:local]))

    session
  end

  @doc """
  Enable tracing of all function calls from Electric.ShapeCache.Storage for the current process.

  Whenever a traced function is called, a trace message is sent to the current process. See
  also `collect_traced_calls/0`.

  Options:

    - `pid: <pid>` - trace this process instead of self()
    - `functions: [<atom>]` - a list of function names to trace; by default all functions are traced

  """
  def trace_storage_calls(opts) do
    trace_specs =
      if funcs = opts[:functions] do
        Enum.map(funcs, fn
          {name, arity} -> {Storage, name, arity}
          name when is_atom(name) -> {Storage, name}
        end)
      else
        [Storage]
      end

    trace_calls(trace_specs, opts)
  end

  @doc """
  Enable tracing of function calls from Electric.Replication.ShapeLogCollector.

  Options:

    - `pid: <pid>` - trace this process instead of self()
    - `functions: [<atom>]` - a list of function names to trace; by default all functions are traced

  """
  def trace_shape_log_collector_calls(opts \\ []) do
    trace_specs =
      if funcs = opts[:functions] do
        Enum.map(funcs, fn
          {name, arity} -> {ShapeLogCollector, name, arity}
          name when is_atom(name) -> {ShapeLogCollector, name}
        end)
      else
        [ShapeLogCollector]
      end

    trace_calls(trace_specs, opts)
  end

  @doc """
  Get the list of all traced calls already sitting in the current process' mailbox.

  Matches trace messages for any module.
  """
  def collect_traced_calls do
    timeout = Keyword.fetch!(ExUnit.configuration(), :assert_receive_timeout)

    receive do
      {:trace, _test_pid, :call, {_mod, _f, _a} = mfa} ->
        [mfa | collect_traced_calls()]
    after
      timeout -> []
    end
  end
end
