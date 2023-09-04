defmodule Electric.Replication.SatelliteCollectorProducer do
  @moduledoc """
  A producer that's meant to feed the SlotServer from a cache of transactions which
  came from a number of Satellites.

  This is a "fan-in" piece of architecture, where we merge the incoming operations
  from all clients into one stream, and push them to Postgres. Conflict resolution
  triggers on Postgres should take care of properly conflict-resolving inserts based
  on the metadata, regardless of observed operation order.
  """
  use GenStage

  alias Electric.Postgres.Extension
  alias Electric.Replication.Changes.NewRecord

  require Logger

  def start_link(opts) do
    GenStage.start_link(__MODULE__, [], Keyword.take(opts, [:name]))
  end

  def name(identifier \\ :default) do
    {:via, :gproc, {:n, :l, {__MODULE__, identifier}}}
  end

  def store_incoming_transactions(_, []), do: :ok

  def store_incoming_transactions(server, transactions) do
    GenStage.call(server, {:store_incoming_transactions, transactions})
  end

  # Internal API

  @impl GenStage
  def init(_) do
    table = ETS.Set.new!(ordered: true, keypos: 2)
    {:producer, %{table: table, next_key: 0, demand: 0, starting_from: -1}}
  end

  @impl GenStage
  def handle_call({:store_incoming_transactions, transactions}, _, state) do
    transactions
    |> Stream.reject(&Enum.empty?(&1.changes))
    |> Stream.map(fn tx ->
      # NOTE(alco): !!! Potential data race warning !!!
      # Imagine a scenario when a client sends a transaction to the server and then immediately disconnects.
      # If it reconnects soon afterwards, such that Postgres has not had time to commit the transaction yet,
      # the client's LSN fetched from Postgres will not include the already submitted transaction, cuasing
      # the client to send it once again.
      #
      # We deem it a non-issue because:
      #
      #    * if a repeat transaction is applied immediately after the first one, our conflict-resolution
      #      logic makes it a no-op
      #
      #    * if a repeat transaction is applied after an intermediate transaction from a different client
      #      has written to the same row(s), the repeat transaction is discarded by the LWW logic.
      Map.update!(tx, :changes, fn changes ->
        lsn_change = %NewRecord{
          relation: Extension.acked_client_lsn_relation(),
          record: %{"client_id" => tx.origin, "lsn" => encode_binary_to_bytea(tx.lsn)}
        }

        [lsn_change | changes]
      end)
    end)
    |> Stream.with_index(state.next_key)
    |> Enum.to_list()
    |> then(&ETS.Set.put(state.table, &1))

    next_key = ETS.Set.last!(state.table) + 1

    {:noreply, events, state} = send_events_from_ets(%{state | next_key: next_key})

    {:reply, :ok, events, state}
  end

  @impl GenStage
  def handle_subscribe(producer_or_consumer, subscription_options, _from, state) do
    Logger.debug(
      "Subscription request to satellite collector producer from #{producer_or_consumer} with #{inspect(subscription_options)}"
    )

    starting_from = Keyword.get(subscription_options, :starting_from) || -1

    if starting_from >= state.next_key do
      # The subscriber starts from a point in the future, which is only possible on a server restart,
      # where PG connects with an LSN mapped to a point in this producer's stream, but the stream was lost.
      # The only correct thing to do here is to start from scratch.
      {:automatic, %{state | starting_from: -1}}
    else
      {:automatic, %{state | starting_from: starting_from}}
    end
  end

  @impl GenStage
  def handle_demand(incoming_demand, state) do
    Logger.debug("Handling incoming demand #{incoming_demand}")
    send_events_from_ets(Map.update!(state, :demand, &(&1 + incoming_demand)))
  end

  @impl GenStage
  def handle_info({:sent_all_up_to, key}, state) do
    ETS.Set.select_delete!(state.table, [{{:_, :"$1"}, [{:"=<", :"$1", key}], [true]}])

    {:noreply, [], state}
  end

  defp send_events_from_ets(%{demand: 0} = state), do: {:noreply, [], state}

  defp send_events_from_ets(%{demand: demand, table: set, starting_from: from} = state) do
    results =
      case ETS.Set.select!(set, [{{:"$1", :"$2"}, [{:>, :"$2", from}], [:"$$"]}], demand) do
        :"$end_of_table" -> []
        {results, _continuation} -> results
      end

    case Electric.Utils.list_last_and_length(results) do
      {_, 0} ->
        {:noreply, [], state}

      {[_, last_key], fulfilled} ->
        {:noreply, Enum.map(results, fn [tx, pos] -> {tx, pos} end),
         %{state | demand: demand - fulfilled, starting_from: last_key}}
    end
  end

  # Because we're using the text format for tuple values in the logical replication stream between Postgres and
  # Electric, we have to encode the raw binary into one of Postgres' input encodings for BYTEA, of which the hex
  # encoding is the simpler one.
  #
  # https://www.postgresql.org/docs/current/datatype-binary.html#id-1.5.7.12.9
  defp encode_binary_to_bytea(bin) do
    for <<bbbb::4 <- bin>>, into: "\\x", do: <<to_hex_digit(bbbb)>>
  end

  defp to_hex_digit(d) when d in 0..9, do: ?0 + d
  defp to_hex_digit(d) when d in 10..15, do: ?a + d - 10
end
