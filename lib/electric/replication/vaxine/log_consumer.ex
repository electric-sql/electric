defmodule Electric.Replication.Vaxine.LogConsumer do
  use GenStage

  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Vaxine

  require Logger
  require Electric.Retry

  defmodule State do
    defstruct producer: nil

    @type t() :: %__MODULE__{
            producer: Electric.reg_name()
          }
  end

  @spec start_link(String.t(), Electric.reg_name()) :: GenServer.on_start()
  def start_link(name, producer) do
    GenStage.start_link(__MODULE__, [name, producer], [])
  end

  @spec get_name(term()) :: Electric.reg_name()
  def get_name(param) do
    {:via, :gproc, name(param)}
  end

  defp name(param) do
    {:n, :l, {__MODULE__, param}}
  end

  defp producer_info() do
    [min_demand: 10, max_demand: 50]
  end

  @impl true
  def init([origin, {:via, :gproc, producer}]) do
    :gproc.reg(name(origin))
    :gproc.nb_wait(producer)

    Logger.metadata(vx_consumer: origin)
    Logger.debug("Vaxine consumer started for #{origin} consume from #{inspect(producer)}")
    {:consumer, %State{producer: producer}}
  end

  @impl true
  def handle_call(_, _, state) do
    {:reply, {:error, :not_supported}, [], state}
  end

  @impl true
  def handle_cast(_, state) do
    {:noreply, [], state}
  end

  @impl true
  def handle_info({:gproc, _, :registered, {_stage, pid, _}}, state) do
    Logger.debug("request subscription")
    :ok = GenStage.async_subscribe(self(), [{:to, pid} | producer_info()])
    {:noreply, [], state}
  end

  @impl true
  def handle_info(msg, state) do
    Logger.warn("request unhandled #{inspect(msg)}")
    {:noreply, [], state}
  end

  @impl true
  def handle_events(events, _, state) do
    state =
      Enum.reduce(events, state, fn event, state1 ->
        handle_event(event, state1)
      end)

    {:noreply, [], state}
  end

  defp handle_event(%Transaction{changes: []} = tx, state) do
    %{origin: _origin, publication: publication} = tx

    Logger.debug("Empty transaction in publication `#{publication}`")
    {:noreply, [], state}
  end

  defp handle_event(%Transaction{} = tx, state) do
    %Transaction{ack_fn: ack_fn, origin: origin, publication: publication} = tx

    Logger.debug("New transaction in publication `#{publication}`: #{inspect(tx, pretty: true)}")

    res =
      Electric.Retry.retry_while total_timeout: 10000, max_single_backoff: 1000 do
        case Vaxine.transaction_to_vaxine(tx, publication, origin) do
          :ok ->
            # FIXME: Persist LSN from PG to Vaxine
            :ok = ack_fn.()
            {:halt, :ok}

          {_change, error} ->
            Logger.warning("Failure to write change into vaxine #{error}")
            {:cont, tx}
        end
      end

    case res do
      :ok ->
        {:noreply, [], state}

      _ ->
        # FIXME: Vaxine node might be down, reconnect to other instance?
        {:stop, :vaxine_error, state}
    end
  end
end
