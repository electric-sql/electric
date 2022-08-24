defmodule Electric.Replication.Vaxine.LogProducer do
  @moduledoc """
  Connects vx_client, requests messages according to demand and forwards them
  """

  use GenStage

  require Logger

  alias Electric.Replication.DownstreamProducer
  alias Electric.Replication.Vaxine.TransactionBuilder

  @behaviour DownstreamProducer

  @type vx_txn_data ::
          {key :: binary(), type :: atom(), materialized_value :: term(), ops :: list(term())}
  @type vx_wal_txn ::
          {:vx_wal_txn, tx_id :: term(), dcid :: term(), wal_offset :: term(),
           data :: [vx_txn_data()]}

  @max_backoff_ms 5000
  @starting_demand 5

  @impl DownstreamProducer
  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts)
  end

  @impl DownstreamProducer
  def start_replication(producer, offset) do
    GenStage.call(producer, {:start_replication, offset})
  end

  @impl DownstreamProducer
  def connected?(producer) do
    GenStage.call(producer, :connected?)
  end

  @impl GenStage
  def init(opts) do
    Process.flag(:trap_exit, true)

    state = %{
      address: opts[:vaxine_hostname] |> String.to_charlist(),
      port: opts[:vaxine_port],
      connection_timeout: opts[:vaxine_connection_timeout] || 1000,
      demand: 0,
      backoff: :backoff.init(100, @max_backoff_ms),
      socket_pid: nil,
      last_vx_offset_sent: nil
    }

    {:producer, state, dispatcher: GenStage.DemandDispatcher}
  end

  @impl GenStage
  def handle_call({:start_replication, offset}, _from, state) do
    {:ok, state} = do_start_replication(offset, state)
    {:reply, :ok, [], state}
  end

  @impl GenStage
  def handle_call(:connected?, _from, %{socket_pid: nil} = state) do
    {:reply, false, [], state}
  end

  @impl GenStage
  def handle_call(:connected?, _from, %{socket_pid: pid} = state) do
    {:reply, Process.alive?(pid), [], state}
  end

  @impl GenStage
  def handle_info(:start_replication, state) do
    {:ok, state} = do_start_replication(state.last_vx_offset_sent, state)
    {:noreply, [], state}
  end

  @impl GenStage
  def handle_info({:vx_client_msg, _from, :ok, _await_sync}, state) do
    {_, backoff} = :backoff.succeed(state.backoff)

    {:noreply, [], %{state | backoff: backoff}}
  end

  def handle_info({:vx_client_msg, _from, msg, await_sync}, state) do
    state = maybe_get_next_stream_bulk(await_sync, state)
    %{last_vx_offset_sent: last_vx_offset_sent} = state

    case process_message(msg) do
      # Skipping already sent message, we receive one of those on startup
      {:ok, {_tx, ^last_vx_offset_sent}} ->
        {:noreply, [], state}

      {:ok, {tx, offset}} ->
        {:noreply, [{tx, offset}], %{state | last_vx_offset_sent: offset}}

      {:error, _reason} ->
        {:noreply, [], state}
    end
  end

  def handle_info({:EXIT, pid, reason}, state) do
    if continue?(pid, reason, state) do
      {backoff_time, backoff} = :backoff.fail(state.backoff)
      :erlang.send_after(backoff_time, self(), :start_replication)

      "VaxineLogProducer #{inspect(self())} couldn't connect to Vaxine, retrying in #{backoff_time}ms"
      |> Logger.warn()

      {:noreply, [], %{state | backoff: backoff}}
    else
      {:stop, reason, state}
    end
  end

  defp continue?(pid, reason, state) do
    case reason do
      {:bad_return_from_init, _} -> true
      _ -> pid == state.socket_pid
    end
  end

  @impl GenStage
  def handle_demand(incoming_demand, state) do
    {:noreply, [], %{state | demand: state.demand + incoming_demand}}
  end

  defp do_start_replication(offset, state) do
    with {:ok, pid} <-
           :vx_client.connect(state.address, state.port,
             connection_timeout: state.connection_timeout
           ),
         :ok <- :vx_client.start_replication(pid, sync: @starting_demand, offset: offset || 0) do
      Logger.info(
        "VaxineLogProducer #{inspect(self())} connected to Vaxine and started replication from offset #{inspect(offset)}"
      )

      # Backoff is not reset here, instead it is reset when first message is received
      {:ok, %{state | socket_pid: pid, last_vx_offset_sent: offset}}
    else
      # No-op. We handle the EXIT signal we receive from the crashing process
      # instead. We will eventually start the replication, so answer is ok
      {:error, _} ->
        {:ok, state}
    end
  end

  defp process_message(vaxine_tx) do
    with {:ok, metadata} <- TransactionBuilder.extract_metadata(vaxine_tx),
         {:ok, tx} <- TransactionBuilder.build_transaction(vaxine_tx, metadata) do
      {:ok, {tx, elem(vaxine_tx, 3)}}
    else
      {:error, _} = error ->
        "Failed to process Vaxine message with error #{inspect(error)}, no-op done"
        |> Logger.info(vaxine_tx: vaxine_tx)

        error
    end
  end

  defp maybe_get_next_stream_bulk(await_sync, state) do
    if await_sync do
      Logger.debug(
        "LogProducer #{inspect(self())} requesting next stream bulk for #{state.demand} items"
      )

      :vx_client.get_next_stream_bulk(state.socket_pid, state.demand)
      %{state | demand: 0}
    else
      state
    end
  end
end
