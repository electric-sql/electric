defmodule Electric.ReplicationServer.Vaxine.LogProducer do
  @moduledoc """
  Connects vx_client, buffers incoming messages and sends
  them to consumer on demand.
  """

  @type vx_txn_data ::
          {key :: binary(), type :: atom(), materialized_value :: term(), ops :: list(term())}
  @type vx_wal_txn :: {:vx_wal_txn, tx_id :: term, data :: [vx_txn_data()]}

  use GenStage

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts)
  end

  @impl true
  def init(opts) do
    address = opts[:hostname] |> String.to_charlist()
    port = opts[:port]
    {:ok, pid} = :vx_client.connect(address, port, [])
    :ok = :vx_client.start_replication(pid, [])

    {:producer, {:queue.new(), 0}, dispatcher: GenStage.DemandDispatcher}
  end

  @impl true
  def handle_info({:vx_client_msg, _from, :ok}, {queue, pending_demand}) do
    {:noreply, [], {queue, pending_demand}}
  end

  def handle_info({:vx_client_msg, from, msg}, {queue, pending_demand}) do
    queue =
      msg
      |> build_message(from)
      |> :queue.in(queue)

    dispatch_events(queue, pending_demand, [])
  end

  def ack(_, _, _) do
    :ok
  end

  @impl true
  def handle_demand(incoming_demand, {queue, pending_demand}) do
    dispatch_events(queue, incoming_demand + pending_demand, [])
  end

  defp dispatch_events(queue, 0, events) do
    {:noreply, Enum.reverse(events), {queue, 0}}
  end

  defp dispatch_events(queue, demand, events) do
    case :queue.out(queue) do
      {{:value, event}, queue} ->
        dispatch_events(queue, demand - 1, [event | events])

      {:empty, queue} ->
        {:noreply, Enum.reverse(events), {queue, demand}}
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
