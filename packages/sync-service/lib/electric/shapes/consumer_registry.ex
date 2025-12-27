defmodule Electric.Shapes.ConsumerRegistry do
  alias Electric.ShapeCache
  alias Electric.Telemetry.OpenTelemetry

  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]

  require Logger

  defstruct table: nil,
            stack_id: nil

  @type stack_id() :: Electric.stack_id()
  @type stack_ref() :: stack_id() | [stack_id: stack_id()] | %{stack_id: stack_id()}
  @type shape_handle() :: Electric.shape_handle()
  @type t() :: %__MODULE__{
          table: :ets.table(),
          stack_id: stack_id()
        }

  @consumer_suspend_reason Electric.ShapeCache.ShapeCleaner.consumer_suspend_reason()

  def name(stack_id, shape_handle) when is_stack_id(stack_id) and is_shape_handle(shape_handle) do
    {:via, __MODULE__, {stack_id, shape_handle}}
  end

  def register_name({stack_id, shape_handle}, pid)
      when is_stack_id(stack_id) and is_shape_handle(shape_handle) do
    if register_consumer!(pid, shape_handle, ets_name(stack_id)), do: :yes, else: :no
  end

  # don't unregister when the pid exits -- we have mechanisms to ensure that happens cleanly
  def unregister_name({_stack_id, _shape_handle}) do
    :ok
  end

  def whereis_name({stack_id, shape_handle}) do
    whereis(stack_id, shape_handle) || :undefined
  end

  @spec whereis(stack_ref(), shape_handle()) :: pid() | nil
  def whereis(stack_ref, shape_handle) when is_shape_handle(shape_handle) do
    consumer_pid(shape_handle, ets_name(stack_ref))
  end

  @spec active_consumer_count(stack_id()) :: non_neg_integer()
  def active_consumer_count(stack_id) when is_binary(stack_id) do
    case :ets.info(ets_name(stack_id), :size) do
      :undefined -> 0
      size -> size
    end
  rescue
    ArgumentError -> 0
  end

  @spec register_consumer(pid(), shape_handle(), stack_id()) :: {:ok, non_neg_integer()}
  def register_consumer(pid, shape_handle, stack_id) when is_binary(stack_id) do
    register_consumer(pid, shape_handle, ets_name(stack_id))
  end

  @spec register_consumer(pid(), shape_handle(), t()) :: {:ok, non_neg_integer()}
  def register_consumer(pid, shape_handle, %__MODULE__{table: table}) do
    register_consumer(pid, shape_handle, table)
  end

  @spec register_consumer(pid(), shape_handle(), :ets.table()) :: {:ok, non_neg_integer()}
  def register_consumer(pid, shape_handle, table) when is_atom(table) or is_reference(table) do
    register_consumer!(pid, shape_handle, table)
    :ok
  end

  defp register_consumer!(pid, shape_handle, table)
       when is_pid(pid) and (is_atom(table) or is_reference(table)) do
    :ets.insert_new(table, [{shape_handle, pid}])
  end

  @spec publish(%{shape_handle() => term()}, t()) :: :ok
  def publish(events_by_handle, _registry_state) when events_by_handle == %{} do
    :ok
  end

  def publish(events_by_handle, registry_state) do
    %{table: table} = registry_state

    events_by_handle
    |> Enum.map(fn {handle, event} ->
      {handle, event, consumer_pid(handle, table) || start_consumer!(handle, registry_state)}
    end)
    |> broadcast()
    |> publish(registry_state)
  end

  @spec remove_consumer(shape_handle(), t()) :: :ok
  def remove_consumer(shape_handle, %__MODULE__{table: table}) do
    do_remove_consumer(shape_handle, table)
  end

  @spec remove_consumer(shape_handle(), stack_id()) :: :ok
  def remove_consumer(shape_handle, stack_id) when is_stack_id(stack_id) do
    do_remove_consumer(shape_handle, ets_name(stack_id))
  end

  @spec do_remove_consumer(shape_handle(), :ets.table()) :: :ok
  defp do_remove_consumer(shape_handle, table) when is_atom(table) or is_reference(table) do
    :ets.delete(table, shape_handle)

    Logger.debug(fn -> "Removed consumer #{shape_handle}" end)

    :ok
  end

  @doc """
  Calls many GenServers asynchronously with per-handle messages and waits
  for their responses before returning.

  Returns a map of `shape_handle => event` for handles that need to be retried
  (because their consumers suspended).

  There is no timeout so if the GenServers do not respond or die, this
  function will block indefinitely.
  """
  @spec broadcast([{shape_handle(), term(), pid()}]) :: %{shape_handle() => term()}
  def broadcast(handle_event_pids) do
    # Based on OTP GenServer.call, see:
    # https://github.com/erlang/otp/blob/090c308d7c925e154240685174addaa516ea2f69/lib/stdlib/src/gen.erl#L243
    handle_event_pids
    |> Enum.map(fn {handle, event, pid} ->
      ref = Process.monitor(pid)
      send(pid, {:"$gen_call", {self(), ref}, event})
      {handle, event, ref}
    end)
    |> Enum.flat_map(fn {handle, event, ref} ->
      receive do
        {^ref, _reply} ->
          Process.demonitor(ref, [:flush])
          []

        {:DOWN, ^ref, _, _, @consumer_suspend_reason} ->
          # Catch the race condition where a consumer is in the act of
          # suspending as the txn arrives by retrying those handles (which will
          # start a new consumer instance).
          [{handle, event}]

        {:DOWN, ^ref, _, _, _reason} ->
          []
      end
    end)
    |> Map.new()
    |> tap(fn
      map when map == %{} ->
        :ok

      suspended_handles ->
        Logger.debug(fn ->
          ["Re-trying suspended shape handles ", inspect(Map.keys(suspended_handles))]
        end)
    end)
  end

  @doc """
  Dynamically (re-)enable consumer suspension on all running consumers.

  This allows for dynamically re-configuring consumer suspension even if it was
  disabled, because the configuration message will have the side-effect of
  waking all consumers from hibernation.

  The `max_timeout` value allows for spreading the suspension of existing
  consumers over a large time period to avoid a sudden rush of consumer
  shutdowns after `hibernate_after` ms.

  To re-enable consumer suspend:

      # Make sure consumer suspend is enabled
      Electric.StackConfig.put(stack_id, :shape_enable_suspend?, true)

      # set the hibernation timeout to 1 minute but phase the suspension of
      # existing consumers over a 20 minute period
      Electric.Shapes.ConsumerRegistry.enable_suspend(stack_id, 60_000, 60_000 * 20)

  Disabling suspension is as easy as:

      Electric.StackConfig.put(stack_id, :shape_enable_suspend?, false)

  """
  @spec enable_suspend(stack_id(), pos_integer(), pos_integer()) ::
          consumer_count :: non_neg_integer()
  def enable_suspend(stack_id, hibernate_after, max_timeout)
      when is_integer(hibernate_after) and is_integer(max_timeout) and
             max_timeout > hibernate_after do
    Electric.StackConfig.put(stack_id, :shape_hibernate_after, hibernate_after)
    Electric.StackConfig.put(stack_id, :shape_enable_suspend?, true)

    :ets.foldl(
      fn {_shape_handle, pid}, n ->
        if Process.alive?(pid),
          do: send(pid, {:configure_suspend, hibernate_after, max_timeout})

        n + 1
      end,
      0,
      ets_name(stack_id)
    )
  end

  defp consumer_pid(handle, table) do
    :ets.lookup_element(table, handle, 2, nil)
  rescue
    ArgumentError -> nil
  end

  defp start_consumer!(handle, %__MODULE__{stack_id: stack_id} = state) do
    OpenTelemetry.with_span(
      "consumer_registry.start_consumer",
      ["shape.handle": handle],
      state.stack_id,
      fn ->
        case ShapeCache.start_consumer_for_handle(handle, stack_id) do
          {:ok, pid} ->
            Logger.debug(fn -> ["Started consumer for existing handle ", handle] end)

            pid

          {:error, :no_shape} ->
            nil

          {:error, reason} ->
            raise RuntimeError,
              message:
                "Stack #{stack_id} unable to start consumer process for shape handle #{handle}: #{inspect(reason)}"
        end
      end
    )
  end

  @doc false
  def registry_table(stack_id) do
    :ets.new(ets_name(stack_id), [
      :public,
      :named_table,
      write_concurrency: :auto,
      read_concurrency: true
    ])
  end

  def new(stack_id, opts \\ []) when is_binary(stack_id) do
    table = registry_table(stack_id)

    state = struct(__MODULE__, Keyword.merge(opts, stack_id: stack_id, table: table))

    {:ok, state}
  end

  defp ets_name(opts) when is_list(opts) or is_map(opts) do
    ets_name(Access.fetch!(opts, :stack_id))
  end

  defp ets_name(stack_id) when is_stack_id(stack_id) do
    :"#{inspect(__MODULE__)}:#{stack_id}"
  end
end
