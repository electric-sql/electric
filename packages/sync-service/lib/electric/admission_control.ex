defmodule Electric.AdmissionControl do
  @moduledoc """
  Simple admission control using ETS-based counters to limit concurrent requests per stack.

  This module prevents server overload by:
  - Limiting the number of concurrent requests per stack
  - Failing fast with 503 + Retry-After when at capacity
  - Using cheap ETS operations for minimal overhead

  ## Usage

      # Try to acquire a permit for a stack
      case Electric.AdmissionControl.try_acquire(stack_id, max_concurrent: 1000) do
        :ok ->
          # Request is allowed, process it
          # Don't forget to call release/1 when done!

        {:error, :overloaded} ->
          # Too many concurrent requests, return 503
      end

      # Always release the permit when done
      Electric.AdmissionControl.release(stack_id)

  ## Configuration

  The max_concurrent limit can be configured in your config files:

      config :electric, :max_concurrent_requests, 1000

  """

  use GenServer
  require Logger

  @table_name :electric_admission_control

  @doc """
  Start the admission control GenServer.
  """
  def start_link(_opts) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  @allowed_kinds ~w|initial existing|a
  for {kind, pos} <- Enum.with_index(@allowed_kinds, 2) do
    defp tuple_pos(unquote(kind)), do: unquote(pos)
  end

  @doc """
  Try to acquire a permit for the given stack_id.

  Returns `:ok` if permit granted, `{:error, :overloaded}` if at capacity.

  ## Options

    * `:max_concurrent` - Maximum concurrent requests allowed (default: 1000)

  ## Examples

      iex> Electric.AdmissionControl.try_acquire("stack-123", max_concurrent: 1000)
      :ok

      iex> Electric.AdmissionControl.try_acquire("stack-123", max_concurrent: 1)
      {:error, :overloaded}

  """
  def try_acquire(stack_id, kind, opts \\ []) when kind in @allowed_kinds do
    max_concurrent =
      Keyword.get_lazy(opts, :max_concurrent, fn ->
        Electric.Config.get_env(:max_concurrent_requests)
      end)

    # Atomically increment counter, but cap at max_concurrent
    # ETS update_counter format: {position, increment, threshold, set_value}
    current =
      :ets.update_counter(
        @table_name,
        stack_id,
        {tuple_pos(kind), 1, max_concurrent, max_concurrent},
        {stack_id, 0, 0}
      )

    if current >= max_concurrent do
      # At or over capacity, decrement back and reject
      :ets.update_counter(@table_name, stack_id, {tuple_pos(kind), -1, 0, 0}, {stack_id, 0, 0})

      # Emit telemetry event
      :telemetry.execute(
        [:electric, :admission_control, :reject],
        %{count: 1},
        %{
          stack_id: stack_id,
          reason: :overloaded,
          kind: kind,
          current: current,
          limit: max_concurrent
        }
      )

      {:error, :overloaded}
    else
      # Successfully acquired permit
      # Emit telemetry for current concurrency level
      :telemetry.execute(
        [:electric, :admission_control, :acquire],
        %{count: 1, current: current},
        %{stack_id: stack_id, kind: kind, limit: max_concurrent}
      )

      :ok
    end
  end

  @doc """
  Release a permit for the given stack_id.

  Always call this after processing a request, even if it errors.
  Consider using a try/after or Plug's `register_before_send/2` callback.

  ## Examples

      iex> Electric.AdmissionControl.release("stack-123")
      :ok

  """
  def release(stack_id) do
    :ets.update_counter(@table_name, stack_id, {2, -1, 0, 0}, {stack_id, 0})
    :ok
  end

  @doc """
  Get the current number of in-flight requests for a stack.

  Useful for monitoring and debugging.

  ## Examples

      iex> Electric.AdmissionControl.get_current("stack-123")
      42

  """
  def get_current(stack_id) do
    case :ets.lookup(@table_name, stack_id) do
      [{^stack_id, count}] -> count
      [] -> 0
    end
  end

  @impl true
  def init(_) do
    :ets.new(@table_name, [
      :named_table,
      :public,
      :set,
      write_concurrency: true,
      read_concurrency: true
    ])

    Logger.info("Admission control initialized")
    {:ok, %{}}
  end
end
