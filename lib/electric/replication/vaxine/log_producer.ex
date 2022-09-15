defmodule Electric.Replication.Vaxine.LogProducer do
  @moduledoc """
  Connects vx_client, requests messages according to demand and forwards them
  """

  use GenStage

  require Logger

  alias Electric.Utils
  alias Electric.Replication.DownstreamProducer
  alias Electric.Replication.Vaxine.TransactionBuilder

  @behaviour DownstreamProducer

  @type vx_wal_offset() :: term()
  @type vx_txn_data ::
          {key :: binary(), type :: atom(), materialized_value :: term(), ops :: list(term())}
  @type vx_wal_txn ::
          {:vx_wal_txn, tx_id :: term(), dcid :: term(), wal_offset :: vx_wal_offset(),
           data :: [vx_txn_data()]}

  @type vaxine_opts :: [
          vaxine_hostname: String.t(),
          vaxine_port: non_neg_integer,
          vaxine_connection_timeout: non_neg_integer
        ]

  @max_backoff_ms 5000
  @starting_demand 5

  defmodule State do
    defstruct address: nil,
              port: 0,
              connection_timeout: 0,
              demand: 0,
              backoff: nil,
              socket_pid: nil,
              last_vx_offset_sent: nil,
              events: :queue.new(),
              async_wait: false

    @type t() :: %__MODULE__{
            address: charlist(),
            port: non_neg_integer(),
            connection_timeout: non_neg_integer(),
            demand: non_neg_integer(),
            backoff: :backoff.backoff(),
            socket_pid: pid(),
            last_vx_offset_sent: term(),
            events: list(),
            async_wait: boolean()
          }
  end

  @impl DownstreamProducer
  @spec start_link(String.t(), vaxine_opts()) :: {:ok, pid} | {:error, term}
  def start_link(name, opts) do
    GenStage.start_link(__MODULE__, [name, opts])
  end

  @spec get_name(String.t()) :: Electric.reg_name()
  def get_name(name) do
    {:via, :gproc, name(name)}
  end

  defp name(name) do
    {:n, :l, {__MODULE__, name}}
  end

  @impl DownstreamProducer
  def start_replication(producer, offset) do
    # Timeout is set to `:infinity` here to account for variable connection
    # timeout setting Without this and with the connection timeout set to a
    # value higher than 5000, the caller crashes here since it doesn't receive a
    # response within the expected window.
    #
    # It's safe to set this to `:infinity` since actual timeout is handled
    # within the function.
    GenStage.call(producer, {:start_replication, offset}, :infinity)
  end

  @impl DownstreamProducer
  def connected?(producer) do
    GenStage.call(producer, :connected?)
  end

  @impl GenStage
  def init([name, opts]) do
    Process.flag(:trap_exit, true)
    :gproc.reg(name(name))

    Logger.metadata(origin: name, vx_producer: opts[:vaxine_hostname])

    state = %State{
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
  def handle_call(:connected?, _from, %State{socket_pid: nil} = state) do
    {:reply, false, [], state}
  end

  @impl GenStage
  def handle_call(:connected?, _from, %State{socket_pid: pid} = state) do
    {:reply, Process.alive?(pid), [], state}
  end

  @impl GenStage
  # Fore subscription retry
  def handle_info(:start_replication, state) do
    {:ok, state} = do_start_replication(state.last_vx_offset_sent, state)
    {:noreply, [], state}
  end

  @impl GenStage
  def handle_info({:vx_client_msg, pid, :ok, _await_sync}, %State{socket_pid: pid} = state) do
    {_, backoff} = :backoff.succeed(state.backoff)

    {:noreply, [], %{state | backoff: backoff}}
  end

  def handle_info({:vx_client_msg, pid, msg, await_sync}, %State{socket_pid: pid} = state) do
    state = maybe_get_next_stream_bulk(await_sync, state)
    %{last_vx_offset_sent: last_vx_offset_sent} = state

    case process_message(msg) do
      # Skipping already sent message, we receive one of those on startup
      {:ok, {_tx, ^last_vx_offset_sent}} ->
        {:noreply, [], state}

      {:ok, {tx, offset}} when state.demand > 0 ->
        {:noreply, [{tx, offset}],
         %{state | last_vx_offset_sent: offset, demand: state.demand - 1}}

      {:ok, {_tx, _offset} = t} ->
        {:noreply, [], %{state | events: :queue.in(t, state.events)}}

      {:error, _reason} ->
        {:noreply, [], state}
    end
  end

  # old messages from previously active subscription
  def handle_info({:vx_client_msg, _, _, _}, state) do
    {:noreply, [], state}
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

  @impl GenStage
  def terminate(reason, state) do
    if reason != :normal, do: Logger.debug("terminate: #{inspect(reason)}")

    state
  end

  defp continue?(pid, reason, state) do
    case reason do
      {:bad_return_from_init, _} -> true
      _ -> pid == state.socket_pid
    end
  end

  @impl GenStage
  def handle_cancel({_, _}, _from, %State{} = state) do
    {:ok, state} = do_stop_replication(state)
    {:noreply, [], %State{state | demand: 0, events: :queue.new()}}
  end

  @impl GenStage
  def handle_demand(incoming_demand, %State{} = state) do
    demand = incoming_demand + state.demand
    {demand, demanded, remaining} = Utils.fetch_demand_from_queue(demand, state.events)
    {:noreply, demanded, %State{state | demand: demand, events: remaining}}
  end

  @impl GenStage
  def handle_subscribe(producer, options, _from, state) do
    self = self()
    Logger.debug("#{inspect(self)} producer: #{producer} options: #{inspect(options)}")

    case Keyword.get(options, :start_subscription, nil) do
      nil ->
        {:automatic, state}

      offset ->
        {:ok, state} = do_start_replication(offset, state)
        {:automatic, state}
    end
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

  defp do_stop_replication(%State{socket_pid: nil} = state), do: {:ok, state}

  defp do_stop_replication(state) do
    with :ok <- :vx_client.stop(state.socket_pid) do
      {:ok, %{state | socket_pid: nil, last_vx_offset_sent: nil}}
    else
      _ ->
        {:ok, %{state | socket_pid: nil, last_vx_offset_sent: nil}}
    end
  end

  @spec process_message(vx_wal_txn()) ::
          {:ok, {Electric.Replication.Changes.Transaction.t(), term()}} | {:error, term()}
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
    cond do
      await_sync and state.demand > 0 ->
        Logger.debug(
          "LogProducer #{inspect(self())} requesting next stream bulk for #{state.demand} items"
        )

        :vx_client.get_next_stream_bulk(state.socket_pid, @starting_demand)
        %{state | async_wait: false}

      await_sync ->
        %{state | async_wait: true}

      true ->
        state
    end
  end
end
