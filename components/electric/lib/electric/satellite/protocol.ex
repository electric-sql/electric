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

  require Logger

  @type lsn() :: non_neg_integer
  @producer_timeout 5_000
  @producer_demand 5

  defmodule Telemetry do
    defstruct connection_span: nil,
              replication_span: nil,
              subscription_spans: %{}

    @type t() :: %__MODULE__{
            connection_span: Metrics.t(),
            replication_span: Metrics.t() | nil,
            subscription_spans: %{optional(subscription_id :: String.t()) => Metrics.t()}
          }

    @spec start_subscription_span(t(), String.t(), map(), map()) :: t()
    def start_subscription_span(
          %__MODULE__{replication_span: parent} = telemetry,
          subscription_id,
          measurements,
          metadata
        ) do
      span =
        Metrics.start_child_span(
          parent,
          [:satellite, :replication, :new_subscription],
          measurements,
          Map.put(metadata, :subscription_id, subscription_id)
        )

      put_in(telemetry.subscription_spans[subscription_id], span)
    end

    @spec subscription_data_ready(t(), String.t()) :: t()
    def subscription_data_ready(%__MODULE__{} = telemetry, id) do
      put_in(
        telemetry.subscription_spans[id].intermediate_measurements[:data_ready_monotonic_time],
        System.monotonic_time()
      )
    end

    @spec stop_subscription_span(t(), String.t()) :: t()
    def stop_subscription_span(%__MODULE__{} = telemetry, id) do
      {span, telemetry} = pop_in(telemetry.subscription_spans[id])
      monotonic_time = System.monotonic_time()
      data_time = span.intermediate_measurements.data_ready_monotonic_time

      Metrics.stop_span(span, %{
        monotonic_time: monotonic_time,
        data_ready_monotonic_time: data_time,
        data_ready_duration: data_time - span.start_time,
        send_lag: monotonic_time - data_time
      })

      telemetry
    end
  end

  defmodule InRep do
    defstruct lsn: "",
              status: nil,
              pid: nil,
              stage_sub: nil,
              relations: %{},
              incomplete_trans: nil,
              demand: 0,
              sub_retry: nil,
              queue: :queue.new(),
              rpc_request_id: 0

    @typedoc """
    Incoming replication Satellite -> PG
    """
    @type t() :: %__MODULE__{
            pid: pid() | nil,
            lsn: String.t(),
            status: nil | :active | :paused | :requested,
            # retry is only used when there is an active consumer
            sub_retry: nil | reference(),
            stage_sub: GenStage.subscription_tag() | nil,
            relations: %{
              optional(PB.relation_id()) => %{
                :schema => String.t(),
                :table => String.t(),
                :columns => [String.t()]
              }
            },
            incomplete_trans: nil | Transaction.t(),
            demand: non_neg_integer(),
            queue: :queue.queue(Transaction.t()),
            rpc_request_id: non_neg_integer()
          }

    @spec add_to_queue(t(), [Transaction.t()]) :: t()
    def add_to_queue(%__MODULE__{queue: queue} = rep, events),
      do: %__MODULE__{rep | queue: Utils.add_events_to_queue(events, queue)}
  end

  defmodule OutRep do
    defstruct lsn: "",
              status: nil,
              pid: nil,
              stage_sub: nil,
              relations: %{},
              last_seen_wal_pos: 0,
              subscription_pause_queue: {nil, :queue.new()},
              outgoing_ops_buffer: :queue.new(),
              subscription_data_to_send: %{},
              last_migration_xid_at_initial_sync: 0

    @typedoc """
    Insertion point for data coming from a subscription fulfillment.
    """
    @type subscription_insert_point :: {xmin :: non_neg_integer(), subscription_id :: binary()}

    @typedoc """
    Outgoing replication PG -> Satellite
    """
    @type t() :: %__MODULE__{
            pid: pid() | nil,
            lsn: String.t(),
            status: nil | :active | :paused,
            stage_sub: GenStage.subscription_tag() | nil,
            relations: %{Changes.relation() => PB.relation_id()},
            last_seen_wal_pos: non_neg_integer,
            # The first element of the tuple is the head of the queue, which is pulled out to be available in guards/pattern matching
            subscription_pause_queue:
              {subscription_insert_point() | nil, :queue.queue(subscription_insert_point())},
            outgoing_ops_buffer: :queue.queue(),
            subscription_data_to_send: %{optional(String.t()) => term()},
            last_migration_xid_at_initial_sync: non_neg_integer
          }

    def add_pause_point(%__MODULE__{subscription_pause_queue: queue} = out, new),
      do: %{out | subscription_pause_queue: add_pause_point(queue, new)}

    def add_pause_point({nil, queue}, new), do: {new, queue}
    def add_pause_point({head, queue}, new), do: {head, :queue.in(new, queue)}

    def remove_next_pause_point(%__MODULE__{subscription_pause_queue: queue} = out),
      do: %{out | subscription_pause_queue: remove_next_pause_point(queue)}

    def remove_next_pause_point({_, queue}) do
      case :queue.out(queue) do
        {{:value, item}, queue} -> {item, queue}
        {:empty, queue} -> {nil, queue}
      end
    end

    def remove_pause_point(%__MODULE__{subscription_pause_queue: queue} = out, subscription_id),
      do: %{out | subscription_pause_queue: remove_pause_point(queue, subscription_id)}

    def remove_pause_point({nil, _} = queue, _), do: queue
    def remove_pause_point({{_, id}, _} = queue, id), do: remove_next_pause_point(queue)

    def remove_pause_point({head, queue}, id),
      do: {head, :queue.delete_with(&match?({_, ^id}, &1), queue)}

    def set_status(%__MODULE__{} = out, status) when status in [nil, :active, :paused],
      do: %{out | status: status}

    def store_subscription_data(%__MODULE__{} = out, id, data),
      do: %{out | subscription_data_to_send: Map.put(out.subscription_data_to_send, id, data)}

    def add_events_to_buffer(%__MODULE__{} = out, events),
      do: %{out | outgoing_ops_buffer: Utils.add_events_to_queue(events, out.outgoing_ops_buffer)}

    def set_event_buffer(%__MODULE__{} = out, buffer) when is_list(buffer),
      do: %{out | outgoing_ops_buffer: :queue.from_list(buffer)}

    def set_event_buffer(%__MODULE__{} = out, {_, _} = buffer),
      do: %{out | outgoing_ops_buffer: buffer}

    def subscription_pending?(_, %__MODULE__{subscription_pause_queue: {nil, _}}), do: false
    def subscription_pending?(id, %__MODULE__{subscription_pause_queue: {{_, id}, _}}), do: true

    def subscription_pending?(id, %__MODULE__{subscription_pause_queue: {_, queue}}),
      do: :queue.any(&match?({_, ^id}, &1), queue)
  end

  defmodule State do
    alias Electric.Replication.Shapes.ShapeRequest

    defstruct auth_passed: false,
              auth: nil,
              last_msg_time: nil,
              client_id: nil,
              expiration_timer: nil,
              in_rep: %InRep{},
              out_rep: %OutRep{},
              auth_provider: nil,
              connector_config: [],
              subscriptions: %{},
              subscription_data_fun: nil,
              telemetry: nil

    @type t() :: %__MODULE__{
            auth_passed: boolean(),
            auth: nil | Electric.Satellite.Auth.t(),
            last_msg_time: :erlang.timestamp() | nil | :ping_sent,
            client_id: String.t() | nil,
            expiration_timer: {reference(), reference()} | nil,
            in_rep: InRep.t(),
            out_rep: OutRep.t(),
            auth_provider: Electric.Satellite.Auth.provider(),
            connector_config: Keyword.t(),
            subscriptions: map(),
            subscription_data_fun: fun(),
            telemetry: Telemetry.t() | nil
          }
  end

  defguard auth_passed?(state) when state.auth_passed == true
  defguard in_rep?(state) when state.in_rep.status == :active
  defguard is_out_rep_active(state) when state.out_rep.status == :active
  defguard is_out_rep_paused(state) when state.out_rep.status == :paused

  defguard is_pending_subscription(state, subscription_id)
           when is_tuple(elem(state.out_rep.subscription_pause_queue, 0)) and
                  elem(elem(state.out_rep.subscription_pause_queue, 0), 1) == subscription_id

  defguard no_pending_subscriptions(state)
           when is_nil(elem(state.out_rep.subscription_pause_queue, 0))

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

      state =
        %State{state | auth: auth, auth_passed: true, client_id: client_id}
        |> schedule_auth_expiration(auth.expires_at)

      {:reply, %SatAuthResp{id: Electric.instance_id()}, state}
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

  def handle_rpc_request(%SatAuthReq{id: client_id, token: token}, state)
      when auth_passed?(state) and client_id === state.client_id and token != "" do
    # Request to renew auth token
    with {:ok, auth} <- Electric.Satellite.Auth.validate_token(token, state.auth_provider) do
      if auth.user_id != state.auth.user_id do
        # cannot change user ID on renewal
        Logger.warning("Client authentication failed: can't change user ID on renewal")
        {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}
      else
        Logger.info("Successfully renewed the token")
        # cancel the old expiration timer and schedule a new one
        state =
          %State{state | auth: auth}
          |> reschedule_auth_expiration(auth.expires_at)

        {:reply, %SatAuthResp{id: Electric.instance_id()}, state}
      end
    else
      {:error, %Electric.Satellite.Auth.TokenError{message: message}} ->
        Logger.warning("Client authentication failed: #{message}")
        {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}

      {:error, reason} ->
        Logger.error("Client authentication failed: #{inspect(reason)}")
        {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}
    end
  end

  def handle_rpc_request(%SatAuthReq{}, state) when auth_passed?(state),
    do: {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}

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
      is_out_rep_paused(state) and Enum.any?(ids, &is_pending_subscription(state, &1))

    out_rep =
      ids
      |> Enum.reduce(state.out_rep, &OutRep.remove_pause_point(&2, &1))
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
          {nil | :stop | PB.sq_pb_msg() | [PB.sq_pb_msg()], State.t()}
          | {:force_unpause, PB.sq_pb_msg() | [PB.sq_pb_msg()], State.t()}
          | {:error, PB.sq_pb_msg()}
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
    %{columns: columns} = SchemaCache.Global.relation!({msg.schema_name, msg.table_name})
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

        %{name: name, type: type, nullable?: col.is_nullable}
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
              telemetry_event(state, :bad_transaction)

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
        telemetry_event(state, :bad_transaction)

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
      telemetry_event(state, :transaction_receive, Transaction.count_operations(tx))
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

    {:reply, %SatInStartReplicationResp{}, start_replication_telemetry(state, :initial_sync)}
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
            |> start_replication_telemetry(subscriptions: length(msg.subscription_ids))
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

  @spec handle_outgoing_txs([{Transaction.t(), term()}], State.t()) ::
          {[PB.sq_pb_msg()], State.t()}
  def handle_outgoing_txs(events, state, acc \\ [])

  def handle_outgoing_txs([{tx, offset} | events], %State{} = state, acc) do
    filtered_tx =
      tx
      |> maybe_strip_migration_ddl(state.out_rep.last_migration_xid_at_initial_sync)
      |> Shapes.filter_changes_from_tx(current_shapes(state))
      |> Changes.filter_changes_belonging_to_user(state.auth.user_id)

    {out_rep, acc} =
      if filtered_tx.changes != [] do
        telemetry_event(
          state,
          :transaction_send,
          Transaction.count_operations(filtered_tx)
          |> Map.put(:original_operations, length(tx.changes))
        )

        {relations, transaction, out_rep} = handle_out_trans({filtered_tx, offset}, state)
        {out_rep, Enum.concat([transaction, relations, acc])}
      else
        Logger.debug("Filtering transaction #{inspect(tx)} for user #{state.auth.user_id}")
        {state.out_rep, acc}
      end

    out_rep = %OutRep{out_rep | last_seen_wal_pos: offset}
    state = %State{state | out_rep: out_rep}
    handle_outgoing_txs(events, state, acc)
  end

  def handle_outgoing_txs([], state, acc) do
    {Enum.reverse(acc), state}
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
  def handle_out_trans({trans, offset}, %State{out_rep: out_rep}) do
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

    {:via, :gproc, producer} = CachedWal.Producer.name(state.client_id)
    {sub_pid, _} = :gproc.await(producer, @producer_timeout)
    sub_ref = Process.monitor(sub_pid)

    opts = [
      to: sub_pid,
      start_subscription: lsn,
      min_demand: 5,
      max_demand: 10
    ]

    msg = {:"$gen_producer", {self(), sub_ref}, {:subscribe, nil, opts}}

    Process.send(sub_pid, msg, [])
    ask({sub_pid, sub_ref}, @producer_demand)

    out_rep = %OutRep{
      out_rep
      | pid: sub_pid,
        status: :active,
        stage_sub: sub_ref,
        last_seen_wal_pos: lsn
    }

    %State{state | out_rep: out_rep}
  end

  # copied from gen_stage.ask, but form is defined as opaque there :/
  def ask({pid, ref}, demand) when is_integer(demand) and demand > 0 do
    Process.send(pid, {:"$gen_producer", {self(), ref}, {:ask, demand}}, [])
  end

  def terminate_subscription(out_rep) do
    Process.demonitor(out_rep.stage_sub)
    GenStage.cancel({out_rep.pid, out_rep.stage_sub}, :cancel)

    %OutRep{out_rep | status: nil, pid: nil, stage_sub: nil}
  end

  def handle_subscription_data(id, data, %State{} = state) do
    state = %{state | telemetry: Telemetry.stop_subscription_span(state.telemetry, id)}

    # TODO: in a perfect world there would be potential to stream out the changes instead of
    #       sending it all at once. It's quite hard to do with :ranch, or I haven't found a way.
    {relations, messages, state} =
      Enum.reduce(data, {[], [], state}, fn shape_data, {relations, messages, state} ->
        {new_relations, new_messages, out_rep} =
          handle_shape_request_data(shape_data, state.out_rep)

        {[new_relations | relations], [new_messages | messages], %{state | out_rep: out_rep}}
      end)

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
       messages,
       %SatSubsDataEnd{}
     ], state}
  end

  defp handle_shape_request_data({id, changes}, out_rep) do
    # TODO: This serializes entire shape data (i.e. entire table) as a transaction.
    #       I don't like that we're websocket-framing this much data, this should be split up
    #       but I'm not sure if we've implemented the collection
    {serialized_log, unknown_relations, known_relations} =
      Serialization.serialize_shape_data_as_tx(changes, out_rep.relations)

    {
      serialize_unknown_relations(unknown_relations),
      [%SatShapeDataBegin{request_id: id}, serialized_log, %SatShapeDataEnd{}],
      %{out_rep | relations: known_relations}
    }
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

    state = start_subscription_telemetry_span(state, id, requests)

    context = %{
      user_id: Pathex.get(state, path(:auth / :user_id)),
      sent_tables:
        Map.values(state.subscriptions)
        |> List.flatten()
        |> Enum.flat_map(fn %ShapeRequest{included_tables: tables} -> tables end)
        |> MapSet.new()
    }

    # I'm dereferencing these here because calling this in Task implies copying over entire `state` just for two fields.
    fun = state.subscription_data_fun
    span = state.telemetry.subscription_spans[id]

    Task.start(fn ->
      # This is `InitiaSync.query_subscription_data/2` by default, but can be overridden for tests.
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
          |> Pathex.over!(path(:out_rep), &OutRep.add_pause_point(&1, {xmin, id}))

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

  @spec start_subscription_telemetry_span(State.t(), String.t(), [ShapeRequest.t()]) :: State.t()
  defp start_subscription_telemetry_span(state, id, requests) do
    {included_tables, {total_requests, hashes}} =
      Enum.flat_map_reduce(requests, {0, []}, fn req, {total, hashes} ->
        {ShapeRequest.included_tables(req), {total + 1, [ShapeRequest.hash(req) | hashes]}}
      end)

    telemetry =
      Telemetry.start_subscription_span(
        state.telemetry,
        id,
        %{
          included_tables: length(Enum.uniq(included_tables)),
          shapes: total_requests
        },
        Map.put(common_metadata(state), :shape_hashes, hashes)
      )

    %{state | telemetry: telemetry}
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

  defp telemetry_event(%State{} = state, event, measurements \\ %{}, metadata \\ %{}) do
    Metrics.untimed_span_event(
      state.telemetry.replication_span,
      event,
      measurements,
      Map.merge(common_metadata(state), metadata)
    )
  end

  defp start_replication_telemetry(state, opts) do
    {subscriptions, initial_sync} =
      case opts do
        :initial_sync -> {0, true}
        [subscriptions: n] when is_integer(n) -> {n, false}
      end

    span =
      Metrics.start_child_span(
        state.telemetry.connection_span,
        [:satellite, :replication],
        %{continued_subscriptions: subscriptions},
        Map.put(common_metadata(state), :initial_sync, initial_sync)
      )

    put_in(state.telemetry.replication_span, span)
  end

  defp common_metadata(%State{} = state) do
    %{client_id: state.client_id, user_id: state.auth && state.auth.user_id}
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

  # No expiration set on the auth state
  defp schedule_auth_expiration(state, nil), do: state

  defp schedule_auth_expiration(state, _exp_time), do: state

  ## NOTE(alco): This is a real implementation of an expiration timer for client connections.
  ## It's deactivated until we figure out a proper way to support sessions and start using their
  ## expiration time for client connection lifetime.
  # defp schedule_auth_expiration(state, exp_time) do
  #   ref = make_ref()
  #   delta_ms = 1000 * (exp_time - Joken.current_time())
  #   timer = Process.send_after(self(), {:jwt_expired, ref}, delta_ms)
  #   %State{state | expiration_timer: {timer, ref}}
  # end

  defp reschedule_auth_expiration(%{expiration_timer: old_timer} = state, exp_time) do
    with {timer, _ref} <- old_timer, do: Process.cancel_timer(timer, async: true)

    %State{state | expiration_timer: nil}
    |> schedule_auth_expiration(exp_time)
  end
end
