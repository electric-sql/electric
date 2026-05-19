defmodule Electric.AdmissionControl do
  @moduledoc """
  Simple admission control using ETS-based counters to limit concurrent requests per stack.

  This module prevents server overload by:
  - Limiting the number of concurrent requests per type of request (initial or existing) within a stack
  - Failing fast with 503 + Retry-After when at capacity
  - Using cheap ETS operations for minimal overhead

  ## Usage

      # Try to acquire a permit for a stack
      case Electric.AdmissionControl.try_acquire(stack_id, :initial, max_concurrent: 1000) do
        :ok ->
          # Request is allowed, process it
          # Don't forget to call release/1 when done!

        {:error, :overloaded} ->
          # Too many concurrent requests, return 503
      end

      # Always release the permit when done
      Electric.AdmissionControl.release(stack_id, :initial)

  ## Configuration

  The max_concurrent limit can be configured in your config files:

      config :electric, :max_concurrent_requests, %{initial: 300, existing: 10_000}

  """

  use GenServer
  require Logger

  @table_name :electric_admission_control

  @doc """
  Start the admission control GenServer.

  ## Options

    * `:table_name` - Custom ETS table name (default: `:electric_admission_control`)
    * `:name` - GenServer name (default: `__MODULE__`)

  """
  def start_link(opts) do
    {name, opts} = Keyword.pop(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
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
    * `:table_name` - ETS table name (default: `:electric_admission_control`)

  ## Examples

      iex> Electric.AdmissionControl.try_acquire("stack-123", :initial, max_concurrent: 1000)
      :ok

      iex> Electric.AdmissionControl.try_acquire("stack-123", :initial, max_concurrent: 1)
      {:error, :overloaded}

  """
  def try_acquire(stack_id, kind, opts \\ []) when kind in @allowed_kinds do
    table_name = Keyword.get(opts, :table_name, @table_name)

    max_concurrent =
      Keyword.get_lazy(opts, :max_concurrent, fn ->
        Electric.Config.get_env(:max_concurrent_requests)
        |> Map.fetch!(kind)
      end)

    current = incr(table_name, stack_id, kind)

    if current > max_concurrent do
      # At or over capacity, decrement back and reject
      decr(table_name, stack_id, kind)

      # Emit telemetry event
      :telemetry.execute(
        [:electric, :admission_control, :reject],
        %{count: 1, limit: max_concurrent},
        %{
          stack_id: stack_id,
          reason: :overloaded,
          kind: kind,
          current: current
        }
      )

      {:error, :overloaded}
    else
      # Successfully acquired permit
      # Emit telemetry for current concurrency level
      :telemetry.execute(
        [:electric, :admission_control, :acquire],
        %{count: 1, current: current, limit: max_concurrent},
        %{stack_id: stack_id, kind: kind}
      )

      :ok
    end
  end

  @doc """
  Release a permit for the given stack_id.

  Always call this after processing a request, even if it errors.
  Consider using a try/after or Plug's `register_before_send/2` callback.

  ## Options

    * `:table_name` - ETS table name (default: `:electric_admission_control`)

  ## Examples

      iex> Electric.AdmissionControl.release("stack-123", :initial)
      :ok

  """
  def release(stack_id, kind, opts \\ []) when kind in @allowed_kinds do
    table_name = Keyword.get(opts, :table_name, @table_name)
    decr(table_name, stack_id, kind)
    :ok
  end

  @doc """
  Move an in-flight permit from `from_kind` to `to_kind` for a stack.

  The caller must already hold a `from_kind` permit (acquired via
  `try_acquire/3`). Calling `try_swap/4` without an outstanding
  `from_kind` permit will silently grant a phantom `to_kind` permit.

  ## Options

    * `:max_concurrent` — required. Cap for `to_kind`.
    * `:table_name` — ETS table (default: `:electric_admission_control`).

  """
  @spec try_swap(String.t(), atom(), atom(), keyword()) :: :ok | {:error, :overloaded}
  def try_swap(stack_id, from_kind, to_kind, opts)
      when from_kind in @allowed_kinds and to_kind in @allowed_kinds do
    table_name = Keyword.get(opts, :table_name, @table_name)
    cap = Keyword.fetch!(opts, :max_concurrent)
    to_pos = tuple_pos(to_kind)
    from_pos = tuple_pos(from_kind)
    default = {stack_id, 0, 0}

    # Plain increment, no threshold clamp. Returns the post-increment value.
    new_to = :ets.update_counter(table_name, stack_id, {to_pos, 1}, default)

    if new_to > cap do
      # Rollback: simple unclamped decrement. We just added 1 atomically,
      # so subtracting our own contribution cannot drive the column below
      # the value other racers (if any) brought it to.
      :ets.update_counter(table_name, stack_id, {to_pos, -1}, default)

      :telemetry.execute(
        [:electric, :admission_control, :swap_rejected],
        %{count: 1, current: new_to, limit: cap},
        %{stack_id: stack_id, from: from_kind, to: to_kind}
      )

      {:error, :overloaded}
    else
      # Success: drop the from_kind permit. Clamp at 0 to be defensive
      # against callers who lied about holding a from_kind permit
      # (documented above as a phantom-permit footgun, not a crash).
      :ets.update_counter(table_name, stack_id, {from_pos, -1, 0, 0}, default)

      :telemetry.execute(
        [:electric, :admission_control, :swap],
        %{count: 1, current: new_to, limit: cap},
        %{stack_id: stack_id, from: from_kind, to: to_kind}
      )

      :ok
    end
  end

  @doc """
  Get the current number of in-flight requests for a stack.

  Returns a map with `:initial` and `:existing` counts.

  Useful for monitoring and debugging.

  ## Options

    * `:table_name` - ETS table name (default: `:electric_admission_control`)

  ## Examples

      iex> Electric.AdmissionControl.get_current("stack-123")
      %{initial: 5, existing: 10}

  """
  def get_current(stack_id, opts \\ []) do
    table_name = Keyword.get(opts, :table_name, @table_name)

    case :ets.lookup(table_name, stack_id) do
      [{^stack_id, initial, existing}] -> %{initial: initial, existing: existing}
      [] -> %{initial: 0, existing: 0}
    end
  end

  @impl true
  def init(opts) do
    table_name = Keyword.get(opts, :table_name, @table_name)

    :ets.new(table_name, [
      :named_table,
      :public,
      :set,
      write_concurrency: true,
      read_concurrency: true
    ])

    Logger.notice("Admission control initialized with table: #{table_name}")
    {:ok, %{table_name: table_name}}
  end

  defp incr(table_name, stack_id, kind) do
    :ets.update_counter(table_name, stack_id, {tuple_pos(kind), 1}, {stack_id, 0, 0})
  end

  defp decr(table_name, stack_id, kind) do
    :ets.update_counter(table_name, stack_id, {tuple_pos(kind), -1, 0, 0}, {stack_id, 0, 0})
  end
end
