defmodule Electric.Shapes.ConsumerRegistry do
  use GenServer

  alias Electric.ShapeCache

  require Logger
  require Record

  defstruct table: nil,
            stack_id: nil,
            start_consumer_fun: &ShapeCache.start_consumer_for_handle/2

  @count_key :consumer_count

  @type stack_id() :: Electric.stack_id()
  @type stack_ref() :: stack_id() | [stack_id: stack_id()] | %{stack_id: stack_id()}
  @type shape_handle() :: Electric.ShapeCacheBehaviour.shape_handle()
  @type start_consumer_fun() :: (shape_handle(), stack_ref() ->
                                   {:ok, [{shape_handle(), pid()}]} | {:error, term()})
  @type registry_state() :: %__MODULE__{
          table: :ets.table(),
          stack_id: stack_id(),
          start_consumer_fun: start_consumer_fun()
        }

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(args) do
    with {:ok, stack_id} <- Keyword.fetch(args, :stack_id) do
      GenServer.start_link(__MODULE__, args, name: name(stack_id))
    end
  end

  def registry_state(opts) do
    struct(__MODULE__, opts)
  end

  @spec get_registry_state!(stack_id()) :: {:ok, registry_state()}
  def get_registry_state(stack_id, opts \\ []) when is_binary(stack_id) do
    with {:ok, state} <- GenServer.call(name(stack_id), :registry_state) do
      {:ok, struct(state, opts)}
    end
  end

  @spec get_registry_state!(stack_id()) :: registry_state()
  def get_registry_state!(stack_id, opts \\ []) when is_binary(stack_id) do
    case get_registry_state(stack_id, opts) do
      {:ok, state} -> state
      _ -> raise RuntimeError, message: "Unable to get registry state"
    end
  end

  @spec active_consumer_count(stack_id()) :: non_neg_integer()
  def active_consumer_count(stack_id) when is_binary(stack_id) do
    :ets.lookup_element(ets_name(stack_id), @count_key, 2)
  end

  @spec register_consumer(shape_handle(), pid(), stack_id()) :: {:ok, non_neg_integer()}
  def register_consumer(shape_handle, pid, stack_id) when is_binary(stack_id) do
    register_consumer(shape_handle, pid, ets_name(stack_id))
  end

  @spec register_consumer(shape_handle(), pid(), registry_state()) :: {:ok, non_neg_integer()}
  def register_consumer(shape_handle, pid, %__MODULE__{table: table}) do
    register_consumer(shape_handle, pid, table)
  end

  @spec register_consumer(shape_handle(), pid(), :ets.table()) :: {:ok, non_neg_integer()}
  def register_consumer(shape_handle, pid, table) when is_atom(table) or is_reference(table) do
    n = register_consumer!(shape_handle, pid, table)
    {:ok, n}
  end

  defp register_consumer!(shape_handle, pid, table) do
    true = :ets.insert_new(table, [{shape_handle, pid}])

    :ets.update_counter(table, @count_key, 1)
  end

  @spec publish([shape_handle()], term(), registry_state()) :: :ok
  def publish(shape_handles, event, registry_state) do
    %{table: table} = registry_state

    shape_handles
    |> Enum.flat_map(fn handle ->
      (consumer_pid(handle, table) || start_consumer!(handle, registry_state)) |> List.wrap()
    end)
    |> broadcast(event)
  end

  @spec remove_consumer(shape_handle(), registry_state()) :: :ok
  def remove_consumer(shape_handle, %__MODULE__{table: table}) do
    :ets.delete(table, shape_handle)

    table
    |> :ets.update_counter(@count_key, -1)
    |> tap(fn n -> Logger.debug("Stopped consumer. #{n} active consumers") end)

    :ok
  end

  @doc """
  Calls many GenServers asynchronously with the same message and waits
  for their responses before returning.

  Returns `:ok` once all GenServers have responded or have died.

  There is no timeout so if the GenServers do not respond or die, this
  function will block indefinitely.
  """
  @spec broadcast([pid()], term()) :: :ok
  def broadcast(pids, message) do
    # Based on OTP GenServer.call, see:
    # https://github.com/erlang/otp/blob/090c308d7c925e154240685174addaa516ea2f69/lib/stdlib/src/gen.erl#L243
    pids
    |> Enum.map(fn pid ->
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

  @spec whereis(stack_ref(), shape_handle()) :: pid() | nil
  def whereis(stack_ref, shape_handle) do
    consumer_pid(shape_handle, ets_name(stack_ref))
  end

  defp consumer_pid(handle, table) do
    :ets.lookup_element(table, handle, 2, nil)
  end

  defp start_consumer!(handle, %__MODULE__{} = state) do
    %__MODULE__{stack_id: stack_id, start_consumer_fun: start_consumer_fun, table: table} = state

    case start_consumer_fun.(handle, stack_id: stack_id) do
      {:ok, pid_handles} ->
        {n, pid} =
          Enum.reduce(pid_handles, {0, nil}, fn {inner_handle, pid}, {_, consumer_pid} ->
            {
              register_consumer!(inner_handle, pid, table),
              if(handle == inner_handle, do: pid, else: consumer_pid)
            }
          end)

        Logger.info("Started consumer #{n} for existing handle #{handle}")

        pid

      {:error, :no_shape} ->
        nil

      {:error, reason} ->
        raise RuntimeError,
          message:
            "Stack #{stack_id} unable to start consumer process for shape handle #{handle}: #{inspect(reason)}"
    end
  end

  @doc false
  def registry_table(stack_id) do
    table = :ets.new(ets_name(stack_id), [:public, :named_table, write_concurrency: :auto])
    :ets.insert(table, {@count_key, 0})
    table
  end

  @impl GenServer
  def init(args) do
    stack_id = Keyword.fetch!(args, :stack_id)

    Process.set_label({:consumer_registry, stack_id})
    metadata = [stack_id: stack_id]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    table = registry_table(stack_id)

    state = %__MODULE__{stack_id: stack_id, table: table}

    {:ok, state}
  end

  @impl GenServer
  def handle_call(:registry_state, _from, state) do
    {:reply, {:ok, state}, state}
  end

  defp ets_name(opts) when is_list(opts) or is_map(opts) do
    ets_name(Access.fetch!(opts, :stack_id))
  end

  defp ets_name(stack_id) when is_binary(stack_id) do
    :"#{__MODULE__}-#{stack_id}"
  end
end
