defmodule Electric.Satellite.Protocol do
  @moduledoc """
  Protocol for communication with Satellite
  """
  use Electric.Satellite.Protobuf
  import Electric.Satellite.Protobuf, only: [is_allowed_rpc_method: 1]

  use Pathex

  import Electric.Postgres.Extension, only: [is_migration_relation: 1]

  alias Electric.Postgres.CachedWal

  alias Electric.Satellite.SubscriptionManager
  alias Electric.Replication.Connectors
  alias Electric.Utils
  alias SatSubsResp.SatSubsError

  alias Electric.Replication.Changes.Transaction
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Postgres.Schema
  alias Electric.Replication.Changes
  alias Electric.Replication.Shapes
  alias Electric.Replication.Shapes.ShapeRequest
  alias Electric.Satellite.Serialization
  alias Electric.Satellite.ClientManager
  alias Electric.Satellite.WriteValidation
  alias Electric.Telemetry.Metrics

  alias Electric.Satellite.Protocol.{State, InRep, OutRep, Telemetry}
  import Electric.Satellite.Protocol.State, only: :macros

  require Logger

  @type lsn() :: non_neg_integer
  @type deep_msg_list() :: PB.sq_pb_msg() | [deep_msg_list()]
  @type actions() :: Shapes.subquery_actions()
  @type outgoing() :: {deep_msg_list(), State.t()} | {:error, deep_msg_list(), State.t()}
  @type txn_processing() :: {deep_msg_list(), actions(), State.t()}

  @producer_demand 5

  @spec handle_rpc_request(PB.rpc_req(), State.t()) ::
          {:error, %SatErrorResp{} | PB.rpc_resp()}
          | {:reply, PB.rpc_resp(), State.t()}
          | {:force_unpause, PB.rpc_resp(), State.t()}
  def handle_rpc_request(%SatAuthReq{id: client_id, token: token}, state)
      when not auth_passed?(state) and client_id != "" and token != "" do
    Logger.metadata(client_id: client_id)
    Logger.debug("Received auth request")

    # NOTE: We treat successful registration with Electric.safe_reg as an
    # indication that at least the previously connected WS client is down.
    # However satellite_client_manager may not necessarily have reacted to that
    # yet. So as long as safe_reg succeeded call to ClientManager should
    # succeed as well
    reg_name = Electric.Satellite.WebsocketServer.reg_name(client_id)

    with {:ok, auth} <- Electric.Satellite.Auth.validate_token(token, state.auth_provider),
         true <- Electric.safe_reg(reg_name, 1000),
         :ok <- ClientManager.register_client(client_id, reg_name) do
      Logger.metadata(user_id: auth.user_id)
      Logger.info("Successfully authenticated the client")
      Metrics.satellite_connection_event(%{authorized_connection: 1})

      {
        :reply,
        %SatAuthResp{id: Electric.instance_id()},
        %State{state | auth: auth, auth_passed: true, client_id: client_id}
      }
    else
      {:error, %SatErrorResp{}} = error ->
        error

      {:error, :already_registered} ->
        Logger.info("attempted multiple connections from the same client")
        {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}

      {:error, %Electric.Satellite.Auth.TokenError{message: message}} ->
        Logger.warning("Client authentication failed: #{message}")
        {:error, %SatErrorResp{error_type: :AUTH_REQUIRED}}

      {:error, reason} ->
        Logger.error("Client authentication failed: #{inspect(reason)}")
        {:error, %SatErrorResp{error_type: :AUTH_REQUIRED}}
    end
  end

  def handle_rpc_request(%SatAuthReq{}, state) when not auth_passed?(state),
    do: {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}

  def handle_rpc_request(_, state) when not auth_passed?(state),
    do: {:error, %SatErrorResp{error_type: :AUTH_REQUIRED}}

  # Satellite client request replication
  def handle_rpc_request(
        %SatInStartReplicationReq{lsn: client_lsn, options: opts} = msg,
        %State{} = state
      ) do
    Logger.debug(
      "Received start replication request lsn: #{inspect(client_lsn)} with options: #{inspect(opts)}"
    )

    with :ok <- validate_schema_version(msg.schema_version),
         {:ok, lsn} <- validate_lsn(client_lsn) do
      handle_start_replication_request(msg, lsn, state)
    else
      {:error, :bad_schema_version} ->
        Logger.warning("Unknown client schema version: #{inspect(msg.schema_version)}")

        {:error,
         start_replication_error(
           :UNKNOWN_SCHEMA_VSN,
           "Unknown schema version: #{inspect(msg.schema_version)}"
         )}

      {:error, {:malformed_lsn, client_lsn}} ->
        Logger.warning("Client has supplied invalid LSN in the request: #{inspect(client_lsn)}")

        {:error,
         start_replication_error(:MALFORMED_LSN, "Could not validate start replication request")}

      {:error, reason} ->
        Logger.warning("Bad start replication request: #{inspect(reason)}")

        {:error,
         start_replication_error(
           :CODE_UNSPECIFIED,
           "Could not validate start replication request"
         )}
    end
  end

  # Satellite requests to stop replication
  def handle_rpc_request(%SatInStopReplicationReq{} = _msg, %State{out_rep: out_rep} = state)
      when is_out_rep_active(state) do
    Logger.debug("Received stop replication request")
    Metrics.satellite_replication_event(%{stopped: 1})
    # FIXME: We do not know whether the client intend to start from last LSN, or
    # optional lsn, so we should just restart producer if the client would
    # request different LSN than we are about to send.
    out_rep = terminate_subscription(out_rep)
    {:reply, %SatInStopReplicationResp{}, %State{state | out_rep: out_rep}}
  end

  # Satellite requests a new subscription to a set of shapes
  def handle_rpc_request(%SatSubsReq{subscription_id: id}, state)
      when byte_size(id) > 128 do
    {:reply,
     %SatSubsResp{
       subscription_id: String.slice(id, 1..128) <> "...",
       err: %SatSubsError{
         message: "ID too long"
       }
     }, state}
  end

  def handle_rpc_request(%SatSubsReq{subscription_id: id}, state)
      when is_map_key(state.subscriptions, id) do
    {:reply,
     %SatSubsResp{
       subscription_id: id,
       err: %SatSubsError{
         message:
           "Cannot establish multiple subscriptions with the same ID. If you want to change the subscription, you need to unsubscribe first."
       }
     }, state}
  end

  def handle_rpc_request(%SatSubsReq{subscription_id: id, shape_requests: []}, state) do
    {:reply,
     %SatSubsResp{
       subscription_id: id,
       err: %SatSubsError{
         message: "Subscription must include at least one shape request"
       }
     }, state}
  end

  def handle_rpc_request(
        %SatSubsReq{subscription_id: id, shape_requests: requests},
        %State{} = state
      ) do
    cond do
      Utils.validate_uuid(id) != {:ok, id} ->
        {:reply,
         %SatSubsResp{
           subscription_id: id,
           err: %SatSubsError{message: "Subscription ID should be a valid UUID"}
         }, state}

      Utils.has_duplicates_by?(requests, & &1.request_id) ->
        {:reply,
         %SatSubsResp{
           subscription_id: id,
           err: %SatSubsError{message: "Duplicated request ids are not allowed"}
         }, state}

      true ->
        case Shapes.validate_requests(requests, Connectors.origin(state.connector_config)) do
          {:ok, requests} ->
            query_subscription_data(id, requests, state)

          {:error, errors} ->
            {:reply,
             %SatSubsResp{
               subscription_id: id,
               err: %SatSubsError{
                 shape_request_error:
                   Enum.map(errors, fn {id, code, message} ->
                     %SatSubsError.ShapeReqError{code: code, request_id: id, message: message}
                   end),
                 message: "Could not establish a subscription due to errors on requests"
               }
             }, state}
        end
    end
  end

  def handle_rpc_request(%SatUnsubsReq{subscription_ids: ids}, %State{} = state) do
    needs_unpausing? =
      is_out_rep_paused(state) and Enum.any?(ids, &is_next_pending_subscription(state, &1))

    out_rep =
      ids
      |> Enum.reduce(state.out_rep, &OutRep.remove_pause_point(&2, :subscription, &1))
      |> Map.update!(:subscription_data_to_send, &Map.drop(&1, ids))

    state =
      state
      |> Map.put(:out_rep, out_rep)
      |> Map.update!(:subscriptions, &Map.drop(&1, ids))

    for id <- ids, do: SubscriptionManager.delete_subscription(state.client_id, id)

    if needs_unpausing? do
      {:force_unpause, %SatUnsubsResp{}, state}
    else
      {:reply, %SatUnsubsResp{}, state}
    end
  end

  @spec process_message(PB.sq_pb_msg(), State.t()) ::
          {nil | :stop | deep_msg_list(), State.t()}
          | {:force_unpause, deep_msg_list(), State.t()}
          | {:error, deep_msg_list()}
  # RPC request handling
  def process_message(%SatRpcRequest{method: method} = req, %State{} = state)
      when is_allowed_rpc_method(method) do
    Logger.debug("Received RPC request #{method}/#{req.request_id}")

    resp = %SatRpcResponse{method: method, request_id: req.request_id}

    case PB.decode_rpc_request(method, req.message) do
      {:ok, decoded} ->
        case handle_rpc_request(decoded, state) do
          {:reply, result, state} ->
            {%{resp | result: {:message, rpc_encode(result)}}, state}

          {:force_unpause, result, state} ->
            {:force_unpause, %{resp | result: {:message, rpc_encode(result)}}, state}

          {:error, %SatErrorResp{} = error} ->
            {:error, %{resp | result: {:error, error}}}

          {:error, result_with_error} ->
            {:error, %{resp | result: {:message, rpc_encode(result_with_error)}}}
        end

      {:error, _} ->
        # Malformed message, close the connection just in case
        {:error, %{resp | result: {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}}}
    end
  end

  def process_message(%SatRpcRequest{method: method} = req, _) do
    Logger.info("Invalid RPC request: unknown method #{method}")

    # Unknown RPC message should not really happen, so close the connection just in case
    {:error,
     %SatRpcResponse{
       method: method,
       request_id: req.request_id,
       result: {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}
     }}
  end

  def process_message(
        %SatRpcResponse{method: "startReplication", result: {:message, msg}},
        state
      ) do
    # Decode the message just to validate
    _ = SatInStartReplicationResp.decode!(msg)
    Logger.debug("Received start replication response")

    case state.in_rep.status do
      :requested ->
        {nil, %State{state | in_rep: %InRep{state.in_rep | status: :active}}}

      :paused ->
        # Could be when consumer is temporary unavailable
        rpc("stopReplication", %SatInStopReplicationReq{}, state)
    end
  end

  def process_message(
        %SatRpcResponse{method: "stopReplication", result: {:message, msg}},
        state
      ) do
    # Decode the message just to validate
    _ = SatInStartReplicationResp.decode!(msg)
    Logger.debug("Received stop replication response")

    in_rep = %InRep{state.in_rep | status: :paused}
    {nil, %State{state | in_rep: in_rep}}
  end

  def process_message(%SatRelation{} = msg, %State{in_rep: in_rep} = state) do
    # Look up the latest schema for the relation to assign correct column types.
    #
    # Even though the server may have applied migrations to the schema that the client hasn't seen yet,
    # we can still look up column types on it due our migrations being additive-only and backwards-compatible.
    %{columns: columns, primary_keys: pks} =
      SchemaCache.Global.relation!({msg.schema_name, msg.table_name})

    relation_columns = Map.new(columns, &{&1.name, &1.type})

    enums = SchemaCache.Global.enums()

    columns =
      for %SatRelationColumn{name: name} = col <- msg.columns do
        typename = Map.fetch!(relation_columns, name)

        type =
          case Schema.lookup_enum_values(enums, typename) do
            nil -> typename
            values -> {:enum, typename, values}
          end

        %{
          name: name,
          type: type,
          nullable?: col.is_nullable,
          pk_position: Enum.find_index(pks, &(&1 == name))
        }
      end

    relations =
      Map.put(in_rep.relations, msg.relation_id, %{
        schema: msg.schema_name,
        table: msg.table_name,
        columns: columns
      })

    {nil, %State{state | in_rep: %InRep{in_rep | relations: relations}}}
  end

  def process_message(%SatOpLog{} = msg, %State{in_rep: in_rep} = state)
      when in_rep?(state) do
    try do
      case Serialization.deserialize_trans(
             state.client_id,
             msg,
             in_rep.incomplete_trans,
             in_rep.relations,
             fn _lsn -> nil end
           ) do
        {incomplete, []} ->
          {nil, %State{state | in_rep: %InRep{in_rep | incomplete_trans: incomplete}}}

        {incomplete, complete} ->
          complete = Enum.reverse(complete)

          case WriteValidation.validate_transactions!(
                 complete,
                 {SchemaCache, Connectors.origin(state.connector_config)}
               ) do
            {:ok, accepted} ->
              {nil, send_transactions(accepted, incomplete, state)}

            {:error, accepted, error, trailing} ->
              state = send_transactions(accepted, incomplete, state)
              Telemetry.event(state, :bad_transaction)

              Logger.error([
                "WriteValidation.Error: " <> to_string(error),
                "\n",
                "Dropping #{length(trailing)} unapplied transactions: #{Enum.map(trailing, & &1.lsn) |> inspect()}"
              ])

              {:error, WriteValidation.Error.error_response(error)}
          end
      end
    rescue
      e ->
        Telemetry.event(state, :bad_transaction)

        Logger.error(Exception.format(:error, e, __STACKTRACE__))
        {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}
    end
  end

  def process_message(%SatOpLog{} = _msg, %State{} = state) do
    Logger.info(
      "incoming replication is not active: #{inspect(state.in_rep.status)} ignore transaction"
    )

    # If not in active state, just ignore message without acknowledgement
    {nil, state}
  end

  def process_message(%SatErrorResp{}, %State{} = state) do
    {:stop, state}
  end

  def process_message(_, %State{}) do
    {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}
  end

  defp send_transactions(complete, incomplete, state) do
    for tx <- complete do
      Telemetry.event(state, :transaction_receive, Transaction.count_operations(tx))
    end

    in_rep =
      %InRep{state.in_rep | incomplete_trans: incomplete}
      |> InRep.add_to_queue(complete)
      |> send_downstream()

    %State{state | in_rep: in_rep}
  end

  @spec handle_start_replication_request(
          %SatInStartReplicationReq{},
          binary() | :initial_sync,
          State.t()
        ) ::
          {:error, %SatErrorResp{} | PB.rpc_resp()}
          | {:reply, PB.rpc_resp(), State.t()}
  defp handle_start_replication_request(
         %{subscription_ids: []} = msg,
         :initial_sync,
         %State{} = state
       ) do
    # This particular client is connecting for the first time, so it needs to perform
    # the initial sync before we start streaming any changes to it.
    #
    # Sending a message to self() here ensures that the SatInStartReplicationResp message is delivered to the
    # client first, followed by the initial migrations.
    send(self(), {:perform_initial_sync_and_subscribe, msg})

    {:reply, %SatInStartReplicationResp{}, Telemetry.start_replication_span(state, :initial_sync)}
  end

  defp handle_start_replication_request(_msg, :initial_sync, _state) do
    {:error,
     start_replication_error(
       :INVALID_POSITION,
       "Cannot resume subscriptions for a first-time client"
     )}
  end

  defp handle_start_replication_request(msg, lsn, state) do
    if CachedWal.Api.lsn_in_cached_window?(lsn) do
      case restore_subscriptions(msg.subscription_ids, state) do
        {:ok, state} ->
          state =
            state
            |> Telemetry.start_replication_span(subscriptions: length(msg.subscription_ids))
            |> subscribe_client_to_replication_stream(lsn)

          {:reply, %SatInStartReplicationResp{}, state}

        {:error, bad_id} ->
          {:error,
           start_replication_error(:SUBSCRIPTION_NOT_FOUND, "Unknown subscription: #{bad_id}")}
      end
    else
      # Once the client is outside the WAL window, we are assuming the client will re-establish subscriptions, so we'll discard them
      SubscriptionManager.delete_all_subscriptions(state.client_id)

      {:error,
       start_replication_error(:BEHIND_WINDOW, "Cannot catch up to the server's current state")}
    end
  end

  def send_downstream(%InRep{} = in_rep) do
    case Utils.fetch_demand_from_queue(in_rep.demand, in_rep.queue) do
      {_remaining_demand, [], _} ->
        in_rep

      {remaining_demand, txns, remaining_txns} ->
        msg = {:"$gen_consumer", {in_rep.pid, in_rep.stage_sub}, txns}
        Process.send(in_rep.pid, msg, [])
        %InRep{in_rep | demand: remaining_demand, queue: remaining_txns}
    end
  end

  @spec handle_outgoing_txs([{Transaction.t(), term()}], State.t()) :: txn_processing()
  def handle_outgoing_txs(events, state, acc \\ {[], %{}})

  def handle_outgoing_txs([{tx, offset} | events], %State{} = state, {msgs_acc, actions_acc}) do
    {%Transaction{} = filtered_tx, new_graph, actions} =
      tx
      |> maybe_strip_migration_ddl(state.out_rep.last_migration_xid_at_initial_sync)
      |> Changes.filter_changes_belonging_to_user(state.auth.user_id)
      |> Shapes.process_transaction(state.out_rep.sent_rows_graph, current_shapes(state))

    {out_rep, acc} =
      if filtered_tx.changes != [] or filtered_tx.origin == state.client_id do
        Telemetry.event(
          state,
          :transaction_send,
          Transaction.count_operations(filtered_tx)
          |> Map.put(:original_operations, length(tx.changes))
        )

        filtered_tx =
          if actions != %{},
            do: %Transaction{filtered_tx | additional_data_ref: state.out_rep.move_in_next_ref},
            else: filtered_tx

        {relations, transaction, out_rep} = handle_out_trans({filtered_tx, offset}, state)

        {%OutRep{out_rep | sent_rows_graph: new_graph},
         {[msgs_acc, relations, transaction], Shapes.merge_actions(actions_acc, actions)}}
      else
        Logger.debug("Filtering transaction #{inspect(tx)} for user #{state.auth.user_id}")
        {state.out_rep, {msgs_acc, actions_acc}}
      end

    out_rep = %OutRep{out_rep | last_seen_wal_pos: offset}
    state = %State{state | out_rep: out_rep}
    handle_outgoing_txs(events, state, acc)
  end

  def handle_outgoing_txs([], state, {msgs_acc, actions_acc}) do
    {msgs_acc, actions_acc, state}
  end

  # If the client received at least one migration during the initial sync, the value of
  # last_migration_xid_at_initial_sync is non-zero. And due to the lag between any changes getting committed to the
  # database and those same changes getting propagated through the cached WAL, we may be looking at the same migration
  # here that the client already received during the initial sync. If this is the case, we strip out all DDL from this
  # transaction and leave only data changes.
  #
  # TODO(alco): this could be simplified by using LSN instead of xid to filter out repeat migrations.
  # See https://linear.app/electric-sql/issue/VAX-768.
  defp maybe_strip_migration_ddl(
         %Transaction{xid: xid, changes: changes} = tx,
         last_migration_xid_at_initial_sync
       )
       when xid <= last_migration_xid_at_initial_sync do
    %{tx | changes: Enum.reject(changes, &is_migration_relation(&1.relation))}
  end

  defp maybe_strip_migration_ddl(tx, _), do: tx

  # The offset here comes from the producer
  @spec handle_out_trans({Transaction.t(), any}, State.t()) ::
          {[%SatRelation{}], [%SatOpLog{}], OutRep.t()}
  defp handle_out_trans({trans, offset}, %State{out_rep: out_rep}) do
    Logger.debug("trans: #{inspect(trans)} with offset #{inspect(offset)}")

    {serialized_log, unknown_relations, known_relations} =
      Serialization.serialize_trans(trans, offset, out_rep.relations)

    if unknown_relations != [],
      do: Logger.debug("Sending previously unseen relations: #{inspect(unknown_relations)}")

    out_rep = %OutRep{out_rep | relations: known_relations}

    {serialize_unknown_relations(unknown_relations), serialized_log, out_rep}
  end

  @spec subscribe_client_to_replication_stream(State.t(), any()) :: State.t()
  def subscribe_client_to_replication_stream(%State{out_rep: out_rep} = state, lsn) do
    Metrics.satellite_replication_event(%{started: 1})

    {pid, ref} =
      Utils.GenStage.gproc_subscribe_self!(
        to: CachedWal.Producer.name(state.client_id),
        start_subscription: lsn,
        min_demand: 5,
        max_demand: 10
      )

    Utils.GenStage.ask({pid, ref}, @producer_demand)

    out_rep = %OutRep{
      out_rep
      | pid: pid,
        status: :active,
        stage_sub: ref,
        last_seen_wal_pos: lsn
    }

    %State{state | out_rep: out_rep}
  end

  def terminate_subscription(out_rep) do
    Process.demonitor(out_rep.stage_sub)
    GenStage.cancel({out_rep.pid, out_rep.stage_sub}, :cancel)

    %OutRep{out_rep | status: nil, pid: nil, stage_sub: nil}
  end

  @spec subscription_data_received(String.t(), term(), State.t()) :: outgoing()
  def subscription_data_received(id, data, state)
      when is_map_key(state.subscriptions, id) do
    Logger.debug("Received initial data for subscription #{id}")

    state = Telemetry.subscription_data_ready(state, id)

    if is_paused_on_subscription(state, id) do
      # We're currently waiting for data from this subscription, we can send it immediately
      send_additional_data_and_unpause({:subscription, id}, data, state)
      |> perform_pending_actions()
    else
      # We're not blocked on waiting for this data yet, store & continue
      {[], State.store_subscription_data(state, id, data)}
    end
  end

  @spec subscription_data_failed(String.t(), term(), State.t()) :: outgoing()
  def subscription_data_failed(id, reason, state) do
    Logger.error(
      "Couldn't retrieve initial data for subscription #{id}, with reason #{inspect(reason)}"
    )

    error = %SatSubsDataError{
      subscription_id: id,
      message: "Could not retrieve initial data for subscription"
    }

    state
    |> State.delete_subscription(id)
    |> case do
      state when is_paused_on_subscription(state, id) ->
        # We're paused on this, we want to send the error and unpause
        send_additional_data_error_and_unpause(error, state)
        |> perform_pending_actions()

      state ->
        # We're either paused on smth else, or replication is stopped, or replication is ongoing
        # In any case, we just remove the "future" pause point and notify the client

        {error, %{state | out_rep: OutRep.remove_pause_point(state.out_rep, :subscription, id)}}
    end
  end

  @spec move_in_data_received(
          non_neg_integer(),
          Graph.t(),
          Shapes.Querying.results(),
          State.t()
        ) :: outgoing()
  def move_in_data_received(ref, _, changes, state) do
    # It's a trade-off where to filter out already-sent changes. Current implementation
    # prefers copying more data into itself and filtering here. Maybe sending a MapSet
    # of already-sent IDs to the Task process that does the querying is more optimal,
    # but more testing is required.
    if is_paused_on_move_in(state, ref) do
      # We're paused waiting for this, send changes immediately
      send_additional_data_and_unpause({:move_in, ref}, changes, state)
      |> perform_pending_actions()
    else
      # Didn't reach the pause point for this move-in yet, just store
      {[], State.store_move_in_data(state, ref, changes)}
    end
  end

  @doc """
  Process all the events up to a possible pause point.
  """
  @spec send_events_and_maybe_pause([PB.sq_pb_msg()], State.t()) :: txn_processing()
  def send_events_and_maybe_pause(events, %State{} = state)
      when no_pending_subscriptions(state) do
    handle_outgoing_txs(events, state)
  end

  def send_events_and_maybe_pause(events, %State{out_rep: out_rep} = state) do
    {{xmin, kind, ref}, _} = out_rep.pause_queue

    case Enum.split_while(events, fn {tx, _} -> tx.xid < xmin end) do
      {events, []} ->
        # We haven't yet reached the pause point
        handle_outgoing_txs(events, state)

      {events, pending} ->
        # We've reached the pause point, but we may have some messages we can send
        {msgs, actions, state} = handle_outgoing_txs(events, state)

        state =
          state.out_rep
          |> OutRep.add_events_to_buffer(pending)
          |> OutRep.set_status(:paused)
          |> then(&%{state | out_rep: &1})

        case State.pop_pending_data(state, kind, ref) do
          {data, state} ->
            send_additional_data_and_unpause(msgs, {kind, ref}, data, state)

          :error ->
            # Data isn't yet available, pause here and send what we can
            {msgs, actions, state}
        end
    end
  end

  @doc """
  Unpause the outgoing replication stream and process all the unsent pending events.

  Result includes a nested listed of messages to be sent and an actions map that should be
  acted upon with `perform_pending_actions` once entire batch is processed.
  """
  @spec unpause_and_send_pending_events(deep_msg_list(), actions(), State.t()) :: txn_processing()
  def unpause_and_send_pending_events(msgs, actions \\ %{}, state) do
    buffer = state.out_rep.outgoing_ops_buffer

    state =
      state.out_rep
      |> OutRep.set_event_buffer([])
      |> OutRep.set_status(:active)
      |> then(&%{state | out_rep: &1})

    {next_msgs, more_actions, state} =
      buffer
      |> :queue.to_list()
      |> send_events_and_maybe_pause(state)

    {[msgs, next_msgs], Shapes.merge_actions(actions, more_actions), state}
  end

  @spec send_additional_data_and_unpause(deep_msg_list(), term(), point, any(), State.t()) ::
          txn_processing()
        when point: {OutRep.pause_kind(), term()}
  defp send_additional_data_and_unpause(msgs \\ [], actions \\ %{}, point, data, %State{} = state)
       when is_tuple(point) and elem(point, 0) in [:subscription, :move_in] do
    state = Map.update!(state, :out_rep, &OutRep.remove_next_pause_point/1)

    {more_msgs, state} = handle_additional_data(point, data, state)

    unpause_and_send_pending_events([msgs, more_msgs], actions, state)
  end

  @spec send_additional_data_error_and_unpause(deep_msg_list(), State.t()) :: txn_processing()
  defp send_additional_data_error_and_unpause(error, state) do
    unpause_and_send_pending_events(
      [error],
      Map.update!(state, :out_rep, &OutRep.remove_next_pause_point/1)
    )
  end

  @spec perform_pending_actions(txn_processing()) :: outgoing()
  def perform_pending_actions({msgs, actions, state}) when actions == %{}, do: {msgs, state}

  def perform_pending_actions({msgs, actions, state}) do
    case query_move_in_data(actions, state) do
      {:ok, state} -> {msgs, state}
      {:error, error_msgs} -> {:error, error_msgs, state}
    end
  end

  defp handle_additional_data({:subscription, id}, data, state),
    do: handle_subscription_data(id, data, state)

  defp handle_additional_data({:move_in, ref}, data, state),
    do: handle_move_in_data(ref, data, state)

  @spec handle_subscription_data(
          binary(),
          {Graph.t(), any(), nonempty_maybe_improper_list()},
          State.t()
        ) :: {deep_msg_list(), State.t()}
  defp handle_subscription_data(id, {graph, data, request_ids}, %State{} = state) do
    state = Telemetry.stop_subscription_span(state, id)

    # TODO: in a perfect world there would be potential to stream out the changes instead of
    #       sending it all at once. It's quite hard to do with :ranch, or I haven't found a way.
    # TODO: Addition of shapes complicated initial data sending for multiple requests due to records
    #       fulfilling multiple requests so we're "cheating" here while the client doesn't care by
    #       sending all but one "request data" messages empty, and stuffing entire response into the first one.
    #       See paired comment in `ElectricTest.SatelliteHelpers.receive_subscription_data/3`
    [req_id | rest] = request_ids

    messages = Enum.map(rest, &[%SatShapeDataBegin{request_id: &1}, %SatShapeDataEnd{}])

    {relations, more_msgs, out_rep} =
      data
      |> Stream.reject(fn {id, _} -> State.row_sent?(state, id) end)
      |> Stream.map(fn {_id, {change, _req_ids}} -> change end)
      |> handle_shape_request_data(req_id, state.out_rep)

    state = %State{state | out_rep: OutRep.merge_in_graph(out_rep, graph)}

    # We use the `last_seen_wal_pos` here since if we're in this function, we're sending the data
    # at this point in the stream, and `last_seen_wal_pos` definitely contains the last LSN seen by
    # the client prior to this point.
    #
    # The reason it's here at all is because for fresh clients who prefetched migrations this is
    # the first replication message they see. If they don't get any data afterwards, then they have
    # no LSN to supply on reconnection, leading to issues/hacks.
    {[
       relations,
       %SatSubsDataBegin{
         subscription_id: id,
         lsn:
           Electric.Postgres.CachedWal.Api.serialize_wal_position(state.out_rep.last_seen_wal_pos)
       },
       [messages, more_msgs],
       %SatSubsDataEnd{}
     ], state}
  end

  defp handle_shape_request_data(changes, request_id, out_rep) do
    # TODO: This serializes entire shape data (i.e. entire table) as a transaction.
    #       I don't like that we're websocket-framing this much data, this should be split up
    #       but I'm not sure if we've implemented the collection
    {serialized_log, unknown_relations, known_relations} =
      Serialization.serialize_shape_data_as_tx(changes, out_rep.relations)

    {
      serialize_unknown_relations(unknown_relations),
      [%SatShapeDataBegin{request_id: request_id}, serialized_log, %SatShapeDataEnd{}],
      %{out_rep | relations: known_relations}
    }
  end

  defp handle_move_in_data(ref, changes, %State{} = state) do
    # No actions are possible from changes formatted as NewRecords.
    {graph, changes, _actions} =
      changes
      |> Stream.reject(fn {id, _} -> State.row_sent?(state, id) end)
      |> Stream.map(fn {_id, {change, _req_ids}} -> change end)
      |> Shapes.process_additional_changes(state.out_rep.sent_rows_graph, current_shapes(state))

    out_rep = state.out_rep

    {msgs, unknown_relations, known_relations} =
      Serialization.serialize_move_in_data_as_tx(ref, changes, out_rep.relations)

    out_rep = %OutRep{out_rep | sent_rows_graph: graph, relations: known_relations}

    {[serialize_unknown_relations(unknown_relations), msgs], %{state | out_rep: out_rep}}
  end

  @spec start_replication_from_client(binary(), State.t()) :: {[PB.sq_pb_msg()], State.t()}
  def start_replication_from_client(lsn, state) do
    {msg, state} = rpc("startReplication", %SatInStartReplicationReq{lsn: lsn}, state)
    {[msg], state}
  end

  @spec stop_replication_from_client(State.t()) :: {[PB.sq_pb_msg()], State.t()}
  def stop_replication_from_client(state) do
    {msg, state} = rpc("stopReplication", %SatInStopReplicationReq{}, state)
    {[msg], state}
  end

  @spec restart_replication_from_client(binary(), State.t()) :: {[PB.sq_pb_msg()], State.t()}
  def restart_replication_from_client(lsn, state) do
    {stop_msgs, state} = stop_replication_from_client(state)
    {start_msgs, state} = start_replication_from_client(lsn, state)
    {stop_msgs ++ start_msgs, state}
  end

  defp validate_schema_version(version) do
    if is_nil(version) or SchemaCache.Global.known_migration_version?(version) do
      :ok
    else
      {:error, :bad_schema_version}
    end
  end

  defp validate_lsn(""), do: {:ok, :initial_sync}

  defp validate_lsn(client_lsn) do
    case CachedWal.Api.parse_wal_position(client_lsn) do
      {:ok, value} -> {:ok, value}
      :error -> {:error, {:malformed_lsn, client_lsn}}
    end
  end

  defp current_shapes(%State{subscriptions: subscriptions, out_rep: out_rep}) do
    subscriptions
    |> Enum.reject(fn {id, _shapes} -> OutRep.subscription_pending?(id, out_rep) end)
    |> Enum.flat_map(fn {_, shapes} -> shapes end)
  end

  @spec query_subscription_data(String.t(), [ShapeRequest.t(), ...], State.t()) ::
          {:reply, %SatSubsResp{}, State.t()}
  defp query_subscription_data(id, requests, %State{} = state) do
    ref = make_ref()
    parent = self()

    state = Telemetry.start_subscription_span(state, id, requests)

    shape_requests = List.flatten(Map.values(state.subscriptions))

    context =
      shape_requests
      |> ShapeRequest.prepare_filtering_context()
      |> Map.put(:user_id, Pathex.get(state, path(:auth / :user_id)))

    # I'm dereferencing these here because calling this in Task implies copying over entire `state` just for two fields.
    fun = state.subscription_data_fun
    span = Telemetry.get_subscription_span(state, id)

    Task.start(fn ->
      # This is `InitialSync.query_subscription_data/2` by default, but can be overridden for tests.
      # Please see documentation on that function for context on the next `receive` block.
      fun.({id, requests, context},
        reply_to: {ref, parent},
        connection: state.connector_config,
        telemetry_span: span
      )
    end)

    receive do
      {:subscription_insertion_point, ^ref, xmin} ->
        Logger.debug(
          "Requested data for subscription #{id}, insertion point is at xmin = #{xmin}"
        )

        SubscriptionManager.save_subscription(state.client_id, id, requests)

        state =
          state
          |> Pathex.force_set!(path(:subscriptions / id), requests)
          |> Pathex.over!(path(:out_rep), &OutRep.add_pause_point(&1, {xmin, :subscription, id}))

        {:reply, %SatSubsResp{subscription_id: id}, state}
    after
      1_000 ->
        {:reply,
         %SatSubsResp{
           subscription_id: id,
           err: %SatSubsError{message: "Internal error while checking data availability"}
         }, state}
    end
  end

  @spec query_move_in_data(Shapes.subquery_actions(), State.t()) ::
          {:ok, State.t()} | {:error, deep_msg_list()}
  defp query_move_in_data(actions, %State{} = state) do
    ref = make_ref()
    parent = self()

    # state = start_subscription_telemetry_span(state, id, requests)

    shape_requests = List.flatten(Map.values(state.subscriptions))

    context =
      shape_requests
      |> ShapeRequest.prepare_filtering_context()
      |> Map.put(:user_id, Pathex.get(state, path(:auth / :user_id)))

    # I'm dereferencing these here because calling this in Task implies copying over entire `state` just for two fields.
    fun = state.move_in_data_fun
    move_in_ref = state.out_rep.move_in_next_ref
    # span = state.telemetry.subscription_spans[id]

    Task.start(fn ->
      # This is `InitialSync.query_subscription_data/2` by default, but can be overridden for tests.
      # Please see documentation on that function for context on the next `receive` block.
      fun.(move_in_ref, actions, context,
        reply_to: {ref, parent},
        connection: state.connector_config
        # telemetry_span: span
      )
    end)

    receive do
      {:subscription_insertion_point, ^ref, xmin} ->
        Logger.debug(
          "Requested data after transaction move-ins, insertion point is at xmin = #{xmin}"
        )

        out_rep =
          state.out_rep
          |> OutRep.add_pause_point({xmin, :move_in, state.out_rep.move_in_next_ref})
          |> OutRep.increment_move_in_ref()

        {:ok, %{state | out_rep: out_rep}}
    after
      1_000 ->
        {:error,
         %SatErrorResp{
           error_type: :REPLICATION_FAILED,
           message:
             "Connection to central database failed, cannot continue the replication because of possible consistency issues"
         }}
    end
  end

  defp serialize_unknown_relations(unknown_relations) do
    Enum.map(
      unknown_relations,
      fn relation ->
        relation
        |> SchemaCache.Global.relation!()
        |> Serialization.serialize_relation()
      end
    )
  end

  defp restore_subscriptions(subscription_ids, %State{} = state) do
    Enum.reduce_while(subscription_ids, {:ok, state}, fn id, {:ok, state} ->
      case SubscriptionManager.fetch_subscription(state.client_id, id) do
        {:ok, results} ->
          state = Map.update!(state, :subscriptions, &Map.put(&1, id, results))
          {:cont, {:ok, state}}

        :error ->
          id = if String.length(id) > 128, do: String.slice(id, 0..125) <> "...", else: id
          {:halt, {:error, id}}
      end
    end)
  end

  defp start_replication_error(code, message) do
    %SatInStartReplicationResp{
      err: %SatInStartReplicationResp.ReplicationError{code: code, message: message}
    }
  end

  @spec rpc(String.t(), PB.rpc_req(), State.t()) :: {%SatRpcRequest{}, State.t()}
  defp rpc(method, message, %State{} = state)
       when is_allowed_rpc_method(method) do
    {request_id, in_rep} = Map.get_and_update!(state.in_rep, :rpc_request_id, &{&1, &1 + 1})

    {%SatRpcRequest{
       method: method,
       request_id: request_id,
       message: rpc_encode(message)
     }, %{state | in_rep: in_rep}}
  end

  defp rpc_encode(%module{} = message), do: IO.iodata_to_binary(module.encode!(message))
end
