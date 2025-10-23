defmodule Electric.Shapes.ConsumerRegistry do
  alias Electric.ShapeCache
  alias Electric.Telemetry.OpenTelemetry

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

  @spec active_consumer_count(stack_id()) :: non_neg_integer()
  def active_consumer_count(stack_id) when is_binary(stack_id) do
    :ets.info(ets_name(stack_id), :size)
  end

  @spec register_consumer(shape_handle(), pid(), stack_id()) :: {:ok, non_neg_integer()}
  def register_consumer(shape_handle, pid, stack_id) when is_binary(stack_id) do
    register_consumer(shape_handle, pid, ets_name(stack_id))
  end

  @spec register_consumer(shape_handle(), pid(), t()) :: {:ok, non_neg_integer()}
  def register_consumer(shape_handle, pid, %__MODULE__{table: table}) do
    register_consumer(shape_handle, pid, table)
  end

  @spec register_consumer(shape_handle(), pid(), :ets.table()) :: {:ok, non_neg_integer()}
  def register_consumer(shape_handle, pid, table) when is_atom(table) or is_reference(table) do
    register_consumer!(shape_handle, pid, table)
    :ok
  end

  defp register_consumer!(shape_handle, pid, table) do
    true = :ets.insert_new(table, [{shape_handle, pid}])
  end

  @spec publish([shape_handle()], term(), t()) :: :ok
  def publish(shape_handles, event, registry_state) do
    %{table: table} = registry_state

    shape_handles
    |> Enum.flat_map(fn handle ->
      (consumer_pid(handle, table) || start_consumer!(handle, registry_state)) |> List.wrap()
    end)
    |> broadcast(event)
  end

  @spec remove_consumer(shape_handle(), t()) :: :ok
  def remove_consumer(shape_handle, %__MODULE__{table: table}) do
    :ets.delete(table, shape_handle)

    Logger.debug(fn -> "Stopped and removed consumer #{shape_handle}" end)

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
    %__MODULE__{stack_id: stack_id, table: table} = state

    OpenTelemetry.with_span(
      "consumer_registry.start_consumer",
      ["shape.handle": handle],
      state.stack_id,
      fn ->
        case ShapeCache.start_consumer_for_handle(handle, stack_id: stack_id) do
          {:ok, pid_handles} ->
            {n, pid} =
              Enum.reduce(pid_handles, {0, nil}, fn {inner_handle, pid}, {n, consumer_pid} ->
                register_consumer!(inner_handle, pid, table)

                {
                  n + 1,
                  if(handle == inner_handle, do: pid, else: consumer_pid)
                }
              end)

            Logger.info("Started #{n} consumer(s) for existing handle #{handle}")

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

  defp ets_name(stack_id) when is_binary(stack_id) do
    :"Electric.Shapes.ConsumerRegistry-#{stack_id}"
  end
end
