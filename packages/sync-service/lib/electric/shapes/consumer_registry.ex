defmodule Electric.Shapes.ConsumerRegistry do
  alias Electric.ShapeCache
  alias Electric.Telemetry.OpenTelemetry

  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]

  require Logger

  defstruct table: nil,
            stack_id: nil

  @type stack_id() :: Electric.stack_id()
  @type stack_ref() :: stack_id() | [stack_id: stack_id()] | %{stack_id: stack_id()}
  @type shape_handle() :: Electric.ShapeCacheBehaviour.shape_handle()
  @type t() :: %__MODULE__{
          table: :ets.table(),
          stack_id: stack_id()
        }

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
    :ets.info(ets_name(stack_id), :size)
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
  def publish(handle_events, registry_state) do
    %{table: table} = registry_state

    for {handle, event} <- handle_events,
        pid = consumer_pid(handle, table) || start_consumer!(handle, registry_state),
        pid != nil do
      {pid, event}
    end
    |> broadcast()
  end

  @spec remove_consumer(shape_handle(), t()) :: :ok
  def remove_consumer(shape_handle, %__MODULE__{table: table}) do
    :ets.delete(table, shape_handle)

    Logger.debug(fn -> "Stopped and removed consumer #{shape_handle}" end)

    :ok
  end

  @doc """
  Calls many GenServers asynchronously with different messages and waits
  for their responses before returning.

  Returns `:ok` once all GenServers have responded or have died.

  There is no timeout so if the GenServers do not respond or die, this
  function will block indefinitely.
  """
  @spec broadcast([{pid(), term()}]) :: :ok
  def broadcast(pid_messages) do
    # Based on OTP GenServer.call, see:
    # https://github.com/erlang/otp/blob/090c308d7c925e154240685174addaa516ea2f69/lib/stdlib/src/gen.erl#L243
    pid_messages
    |> Enum.map(fn {pid, message} ->
      ref = Process.monitor(pid)
      send(pid, {:"$gen_call", {self(), ref}, message})
      ref
    end)
    |> Enum.each(fn ref ->
      receive do
        {^ref, _reply} ->
          Process.demonitor(ref, [:flush])
          :ok

        {:DOWN, ^ref, _, _, _reason} ->
          :ok
      end
    end)
  end

  defp consumer_pid(handle, table) do
    :ets.lookup_element(table, handle, 2, nil)
  end

  defp start_consumer!(handle, %__MODULE__{stack_id: stack_id} = state) do
    OpenTelemetry.with_span(
      "consumer_registry.start_consumer",
      ["shape.handle": handle],
      state.stack_id,
      fn ->
        case ShapeCache.start_consumer_for_handle(handle, stack_id: stack_id) do
          {:ok, pid} ->
            Logger.info("Started consumer for existing handle #{handle}")

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
    :ets.new(ets_name(stack_id), [:public, :named_table, write_concurrency: :auto])
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
    :"Electric.Shapes.ConsumerRegistry-#{stack_id}"
  end
end
