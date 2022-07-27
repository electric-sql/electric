defmodule Electric.ReplicationServer.Vaxine.LogProducer do
  @moduledoc """
  Connects vx_client, buffers incoming messages and sends
  them to consumer on demand.
  """

  use GenStage

  require Logger

  @type vx_txn_data ::
          {key :: binary(), type :: atom(), materialized_value :: term(), ops :: list(term())}
  @type vx_wal_txn :: {:vx_wal_txn, tx_id :: term, data :: [vx_txn_data()]}

  @max_backoff_ms 5000

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts)
  end

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)

    state = %{
      address: opts[:hostname] |> String.to_charlist(),
      port: opts[:port],
      queue: :queue.new(),
      demand: 0,
      backoff: :backoff.init(100, @max_backoff_ms)
    }

    # Can't use `:continue` since it is not yet supported by gen_stage.
    # We can then use a message to simulate a continue, as long as
    # the process can handle demand without being connected
    send(self(), :connect)

    {:producer, state, dispatcher: GenStage.DemandDispatcher}
  end

  def handle_info(:connect, state) do
    case :vx_client.connect(state.address, state.port, []) do
      {:ok, pid} ->
        :ok = :vx_client.start_replication(pid, [])

        Logger.debug(
          "VaxineLogProducer #{inspect(self())} connected to Vaxine and started replication"
        )

        {:noreply, [], %{state | backoff: :backoff.succeed(state.backoff)}}

      # No-op. We handle the EXIT signal we receive from the crashing process
      # instead.
      {:error, _} ->
        {:noreply, [], state}
    end
  end

  @impl true
  def handle_info({:vx_client_msg, _from, :ok}, state) do
    {:noreply, [], state}
  end

  def handle_info({:vx_client_msg, from, msg}, state) do
    queue =
      msg
      |> build_message(from)
      |> :queue.in(state.queue)

    dispatch_events(%{state | queue: queue}, [])
  end

  def handle_info({:EXIT, _pid, _reason}, state) do
    {backoff_time, backoff} = :backoff.fail(state.backoff)
    Logger.warn("VaxineLogProducer couldn't connect to Vaxine, retrying in #{backoff_time}ms")
    :erlang.send_after(backoff_time, self(), :connect)
    {:noreply, [], %{state | backoff: backoff}}
  end

  def ack(_, _, _) do
    :ok
  end

  @impl true
  def handle_demand(incoming_demand, state) do
    dispatch_events(%{state | demand: state.demand + incoming_demand}, [])
  end

  defp dispatch_events(%{demand: 0} = state, events) do
    {:noreply, Enum.reverse(events), state}
  end

  defp dispatch_events(state, events) do
    case :queue.out(state.queue) do
      {{:value, event}, queue} ->
        dispatch_events(%{state | queue: queue, demand: state.demand - 1}, [event | events])

      {:empty, _queue} ->
        {:noreply, Enum.reverse(events), state}
    end
  end

  defp build_message(message, vx_client) do
    %Broadway.Message{
      data: message,
      metadata: %{},
      acknowledger: {__MODULE__, :erlang.make_ref(), vx_client}
    }
  end
end
