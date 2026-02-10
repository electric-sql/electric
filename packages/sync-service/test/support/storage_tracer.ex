defmodule Support.StorageTracer do
  @moduledoc """
  Helper module that can be used to trace calls to Electric.ShapeCache.Storage in tests.

  It is implemented with Erlang's :trace sessions, ensuring isolated tracing between
  concurrently running tests.

  This is a less intrusive a more faithful approach of ensuring certain storage functions are
  called in tests compared to using wrapper modules such as TestStorage or ad-hoc function
  patching with Repatch.
  """

  alias Electric.ShapeCache.Storage

  @doc """
  Enable tracing of all function calls from Electric.ShapeCache.Storage for the current process.

  Whenever a traced function is called, a trace message is sent to the current process. See
  also `collect_traced_calls/0`.

  It is possible to override the traced process and to only trace a selection of functions by passing appropriate options:

    - `pid: <pid>` - trace this process instead of self()
    - `functions: [<atom>]` - a list of function names to test; by default all functions are traced

  """
  def trace_storage_calls(opts) do
    session = :trace.session_create(__MODULE__, self(), [])

    ExUnit.Callbacks.on_exit(fn ->
      :trace.session_destroy(session)
    end)

    traced_pid = opts[:pid]
    :trace.process(session, traced_pid, true, [:call])

    what_to_trace =
      if funcs = opts[:functions] do
        Enum.map(funcs, fn
          {name, arity} -> {Storage, name, arity}
          name when is_atom(name) -> {Storage, name, :_}
        end)
      else
        # Trace all functions
        [{Storage, :_, :_}]
      end

    Enum.each(what_to_trace, &:trace.function(session, &1, true, [:local]))

    session
  end

  @doc """
  Get the list of all traced calls already sitting in the current process' mailbox.
  """
  def collect_traced_calls do
    timeout = Keyword.fetch!(ExUnit.configuration(), :assert_receive_timeout)

    receive do
      {:trace, _test_pid, :call, {Storage, _f, _a} = mfa} ->
        [mfa | collect_traced_calls()]
    after
      timeout -> []
    end
  end
end
