defmodule Electric.Replication.ShapeLogCollector do
  @moduledoc """
  When any txn comes from postgres, we need to store it into the
  log for this shape if and only if it has txid >= xmin of the snapshot.
  """
  use GenStage

  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.{Relation, Transaction}
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @schema NimbleOptions.new!(
            electric_instance_id: [type: :atom, required: true],
            inspector: [type: :mod_arg, required: true],
            # see https://hexdocs.pm/gen_stage/GenStage.html#c:init/1-options
            demand: [type: {:in, [:forward, :accumulate]}, default: :accumulate],
            # should this log collector process shutdown when one of its consumers crashes?
            link_consumers: [type: :boolean, default: true]
          )

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenStage.start_link(__MODULE__, Map.new(opts), name: name(opts[:electric_instance_id]))
    end
  end

  def name(electric_instance_id) do
    Electric.Application.process_name(electric_instance_id, __MODULE__)
  end

  # use `GenStage.call/2` here to make the event processing synchronous.
  #
  # Because `Electric.Shapes.Dispatcher` only sends demand to this producer
  # when all consumers have processed the last event, we can save the `from`
  # clause in the matching `handle_call/3` function and then use
  # `GenServer.reply/2` in the `demand/2` callback to inform the replication
  # client that the replication message has been processed.
  #
  # This `call/3` has a timeout of `:infinity` because timeouts are
  # handled at the storage layer, that is this function doesn't
  # assume any aggregate max time for the shape consumers to actually commit
  # the new tx to disk, instead the storage backend is responsible for
  # determinining how long a write should reasonably take and if that fails
  # it should raise.
  def store_transaction(%Transaction{} = txn, server) do
    ot_span_ctx = OpenTelemetry.get_current_context()
    GenStage.call(server, {:new_txn, txn, ot_span_ctx}, :infinity)
  end

  def handle_relation_msg(%Changes.Relation{} = rel, server) do
    GenServer.call(server, {:relation_msg, rel})
  end

  def init(opts) do
    state = Map.merge(opts, %{producer: nil, subscriptions: {0, MapSet.new()}})
    # start in demand: :accumulate mode so that the ShapeCache is able to start
    # all active consumers before we start sending transactions
    {:producer, state, dispatcher: Electric.Shapes.Dispatcher, demand: opts.demand}
  end

  def handle_subscribe(:consumer, _opts, from, state) do
    {
      :automatic,
      Map.update!(state, :subscriptions, fn {count, set} ->
        {count + 1, MapSet.put(set, from)}
      end)
      |> log_subscription_status()
    }
  end

  # initial subscription before any transactions have been sent
  def handle_demand(_demand, %{producer: nil} = state) do
    {:noreply, [], state}
  end

  # The BroadcastDispatcher only sends demand when all the consumers have
  # demand, so if we are receiving demand then all consumers have processed the
  # last transaction and we can reply to the call and unblock the replication
  # client.
  def handle_demand(_demand, %{producer: producer} = state) do
    GenServer.reply(producer, :ok)
    {:noreply, [], %{state | producer: nil}}
  end

  def handle_cancel({:cancel, _}, from, state) do
    {:noreply, [], remove_subscription(from, state)}
  end

  def handle_cancel({:down, reason}, from, %{link_consumers: true} = state) do
    # See: https://hexdocs.pm/elixir/Supervisor.html#module-exit-reasons-and-restarts
    # If the consumer's shutdown is unexpected, due to some error, then exit with
    # this error and let the supervisor bring us back up.
    state = remove_subscription(from, state)

    case reason do
      {:shutdown, _} ->
        {:noreply, [], state}

      :shutdown ->
        {:noreply, [], state}

      :normal ->
        {:noreply, [], state}

      error ->
        Logger.warning("Terminating LogCollector due to error from consumer: #{inspect(error)}")
        {:stop, {:error, error}, state}
    end
  end

  def handle_cancel({:down, _reason}, from, %{link_consumers: false} = state) do
    {:noreply, [], remove_subscription(from, state)}
  end

  def handle_call({:new_txn, %Transaction{xid: xid, lsn: lsn} = txn, ot_span_ctx}, from, state) do
    OpenTelemetry.set_current_context(ot_span_ctx)

    Logger.info("Received transaction #{xid} from Postgres at #{lsn}")
    Logger.debug(fn -> "Txn received in ShapeLogCollector: #{inspect(txn)}" end)

    OpenTelemetry.with_span("shape_log_collector.handle_txn", [], fn ->
      handle_transaction(txn, from, state)
    end)
  end

  def handle_call({:relation_msg, %Relation{} = rel}, from, %{producer: nil} = state) do
    Logger.info("Received Relation #{inspect(rel.schema)}.#{inspect(rel.table)}")
    Logger.debug(fn -> "Relation received: #{inspect(rel)}" end)
    {:noreply, [rel], %{state | producer: from}}
  end

  # If no-one is listening to the replication stream, then just return without
  # emitting the transaction.
  # We could emit the transaction and let GenStage buffer it, but I don't think
  # this is necessary. We do definitely need to reply though, because without
  # any consumers we'll never get the demand message from the dispatcher that
  # will prompt the `GenServer.reply/2` call.
  defp handle_transaction(txn, _from, %{subscriptions: {0, _}} = state) do
    Logger.debug(fn -> "Dropping transaction #{txn.xid}: no active consumers" end)

    OpenTelemetry.add_span_attributes("txn.is_dropped": true)

    {:reply, :ok, [], state}
  end

  defp handle_transaction(txn, from, state) do
    OpenTelemetry.add_span_attributes("txn.is_dropped": false)

    pk_cols_of_relations =
      for relation <- txn.affected_relations, into: %{} do
        {:ok, info} = Inspector.load_column_info(relation, state.inspector)
        pk_cols = Inspector.get_pk_cols(info)
        {relation, pk_cols}
      end

    txn =
      Map.update!(txn, :changes, fn changes ->
        Enum.map(changes, &Changes.fill_key(&1, pk_cols_of_relations[&1.relation]))
      end)

    # we don't reply to this call. we only reply when we receive demand from
    # the consumers, signifying that every one has processed this txn
    {:noreply, [txn], %{state | producer: from}}
  end

  defp remove_subscription(from, %{subscriptions: {count, set}} = state) do
    subscriptions =
      if MapSet.member?(set, from) do
        {count - 1, MapSet.delete(set, from)}
      else
        Logger.error(
          "Received unsubscribe from unknown consumer: #{inspect(from)}; known: #{inspect(set)}"
        )

        {count, set}
      end

    log_subscription_status(%{state | subscriptions: subscriptions})
  end

  defp log_subscription_status(%{subscriptions: {active, _set}} = state) do
    Logger.debug(fn ->
      "#{active} consumers of replication stream"
    end)

    state
  end
end
