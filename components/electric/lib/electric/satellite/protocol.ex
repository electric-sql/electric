defmodule Electric.Satellite.Protocol do
  @moduledoc """
  Protocol for communication with Satellite
  """
  use Electric.Satellite.Protobuf
  use Pathex

  import Electric.Postgres.Extension, only: [is_migration_relation: 1]

  alias Electric.Postgres.{CachedWal, Extension, SchemaRegistry}

  alias Electric.Satellite.SubscriptionManager
  alias Electric.Replication.Connectors
  alias Electric.Utils
  alias SatSubsResp.SatSubsError

  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes
  alias Electric.Replication.Shapes
  alias Electric.Replication.OffsetStorage
  alias Electric.Satellite.Serialization
  alias Electric.Satellite.ClientManager
  alias Electric.Telemetry.Metrics

  require Logger

  @type lsn() :: non_neg_integer
  @producer_timeout 5_000
  @producer_demand 5

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
              sync_counter: 0,
              sync_batch_size: nil

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
              PB.relation_id() => %{
                :schema => String.t(),
                :table => String.t(),
                :columns => [String.t()]
              }
            },
            incomplete_trans: nil | Transaction.t(),
            demand: pos_integer(),
            queue: :queue.queue(Transaction.t()),
            # Parameters used to acknowledge received messages
            sync_batch_size: nil | non_neg_integer,
            sync_counter: nil | non_neg_integer()
          }
  end

  defmodule OutRep do
    defstruct lsn: "",
              status: nil,
              pid: nil,
              stage_sub: nil,
              relations: %{},
              sync_counter: 0,
              sync_batch_size: nil,
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
            # Parameters used to acknowledge received messages
            sync_batch_size: nil | non_neg_integer,
            sync_counter: nil | non_neg_integer,
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
              client: nil,
              client_id: nil,
              in_rep: %InRep{},
              out_rep: %OutRep{},
              ping_tref: nil,
              transport: nil,
              socket: nil,
              auth_provider: nil,
              pg_connector_opts: [],
              subscriptions: %{},
              subscription_data_fun: nil

    @type t() :: %__MODULE__{
            auth_passed: boolean(),
            auth: nil | Electric.Satellite.Auth.t(),
            last_msg_time: :erlang.timestamp() | nil | :ping_sent,
            client: String.t(),
            client_id: String.t() | nil,
            ping_tref: reference() | nil,
            transport: module(),
            socket: :ranch_transport.socket(),
            in_rep: InRep.t(),
            out_rep: OutRep.t(),
            auth_provider: Electric.Satellite.Auth.provider(),
            pg_connector_opts: Keyword.t(),
            subscriptions: map(),
            subscription_data_fun:
              ({id :: String.t(), [ShapeRequest.t(), ...]},
               reply_to: {reference(), pid()},
               connection: Keyword.t() ->
                 none())
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

  @spec process_message(PB.sq_pb_msg(), State.t()) ::
          {nil | :stop | PB.sq_pb_msg() | [PB.sq_pb_msg()], State.t()}
          | {:force_unpause, PB.sq_pb_msg() | [PB.sq_pb_msg()], State.t()}
          | {:error, PB.sq_pb_msg()}
  def process_message(msg, %State{} = state) when not auth_passed?(state) do
    case msg do
      %SatAuthReq{id: client_id, token: token, headers: headers}
      when client_id !== "" and token !== "" ->
        Logger.debug("Received auth request #{inspect(state.client)} for #{inspect(client_id)}")

        # NOTE: We treat successful registration with Electric.safe_reg as an
        # indication that at least the previously connected WS client is down.
        # However satellite_client_manager may not necessarily have reacted to that
        # yet. So as long as safe_reg succeeded call to ClientManager should
        # succeed as well
        reg_name = Electric.Satellite.WsServer.reg_name(client_id)

        with {:ok, auth} <- Electric.Satellite.Auth.validate_token(token, state.auth_provider),
             :ok <- validate_headers(headers),
             true <- Electric.safe_reg(reg_name, 1000),
             :ok <- ClientManager.register_client(client_id, reg_name) do
          Logger.metadata(client_id: client_id, user_id: auth.user_id)
          Logger.info("authenticated client #{client_id} as user #{auth.user_id}")
          Metrics.satellite_connection_event(%{authorized_connection: 1})

          {%SatAuthResp{id: Electric.instance_id()},
           %State{state | auth: auth, auth_passed: true, client_id: client_id}}
        else
          {:error, %SatErrorResp{}} = error ->
            error

          {:error, %Electric.Satellite.Auth.TokenError{message: message}} ->
            Logger.warning("client authorization failed",
              metadata: [client_id: client_id, error: message]
            )

            {:error, %SatErrorResp{error_type: :AUTH_REQUIRED}}

          {:error, :already_registered} ->
            Logger.info(
              "attempted multiple connections from the client with same id: #{inspect(client_id)}"
            )

            {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}

          {:error, reason} ->
            Logger.error(
              "authorization failed for client: #{client_id} with reason: #{inspect(reason)}"
            )

            {:error, %SatErrorResp{error_type: :AUTH_REQUIRED}}
        end

      %SatAuthReq{} ->
        {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}

      _ ->
        {:error, %SatErrorResp{error_type: :AUTH_REQUIRED}}
    end
  end

  def process_message(%SatPingReq{} = _msg, %State{in_rep: in_rep} = state) do
    Logger.debug("Received ping request, sending lsn #{inspect(in_rep.lsn)}")
    {%SatPingResp{lsn: in_rep.lsn}, state}
  end

  def process_message(%SatPingResp{lsn: confirmed_lsn}, %State{out_rep: out_rep} = state)
      when confirmed_lsn !== "" do
    Logger.debug("Received ping response, with clients lsn: #{inspect(confirmed_lsn)}")
    {nil, %{state | out_rep: %OutRep{out_rep | lsn: confirmed_lsn}}}
  end

  # Satellite client request replication
  def process_message(
        %SatInStartReplicationReq{lsn: client_lsn, options: opts} = msg,
        %State{} = state
      ) do
    Logger.debug(
      "Received start replication request lsn: #{inspect(client_lsn)} with options: #{inspect(opts)}"
    )

    with :ok <- validate_schema_version(msg.schema_version),
         {:ok, lsn} <- validate_lsn(client_lsn, opts) do
      handle_start_replication_request(msg, lsn, state)
    else
      {:error, :bad_schema_version} ->
        Logger.warning("Unknown client schema version: #{inspect(msg.schema_version)}")

        {:error,
         start_replication_error(
           :CODE_UNSPECIFIED,
           "Unknown schema version: #{inspect(msg.schema_version)}"
         )}

      {:error, reason} ->
        Logger.warning("Bad start replication request: #{inspect(reason)}")

        {:error,
         start_replication_error(:CODE_UNSPECIFIED, "Could validate start replication request")}
    end
  end

  # Satellite client confirms replication start
  def process_message(%SatInStartReplicationResp{} = _msg, %State{} = state) do
    Logger.debug("Received start replication response")

    case state.in_rep.status do
      :requested ->
        {nil, %State{state | in_rep: %InRep{state.in_rep | status: :active}}}

      :paused ->
        # Could be when consumer is temporary unavailable
        {%SatInStopReplicationReq{}, state}
    end
  end

  # Satellite requests to stop replication
  def process_message(%SatInStopReplicationReq{} = _msg, %State{out_rep: out_rep} = state)
      when is_out_rep_active(state) do
    Logger.debug("Received stop replication request")
    Metrics.satellite_replication_event(%{stopped: 1})
    # FIXME: We do not know whether the client intend to start from last LSN, or
    # optional lsn, so we should just restart producer if the client would
    # request different LSN than we are about to send.
    out_rep = terminate_subscription(out_rep)
    {%SatInStopReplicationResp{}, %State{state | out_rep: out_rep}}
  end

  # Satellite confirms replication stop
  def process_message(%SatInStopReplicationResp{} = _msg, state) do
    Logger.debug("Received stop replication response")

    in_rep = %InRep{state.in_rep | status: :paused}
    {nil, %State{state | in_rep: in_rep}}
  end

  # Satellite requests a new subscription to a set of shapes
  def process_message(%SatSubsReq{subscription_id: id}, state)
      when byte_size(id) > 128 do
    {%SatSubsResp{
       subscription_id: String.slice(id, 1..128) <> "...",
       err: %SatSubsError{
         message: "ID too long"
       }
     }, state}
  end

  def process_message(%SatSubsReq{subscription_id: id}, state)
      when is_map_key(state.subscriptions, id) do
    {%SatSubsResp{
       subscription_id: id,
       err: %SatSubsError{
         message:
           "Cannot establish multiple subscriptions with the same ID. If you want to change the subscription, you need to unsubscribe first."
       }
     }, state}
  end

  def process_message(%SatSubsReq{subscription_id: id, shape_requests: []}, state) do
    {%SatSubsResp{
       subscription_id: id,
       err: %SatSubsError{
         message: "Subscription must include at least one shape request"
       }
     }, state}
  end

  def process_message(
        %SatSubsReq{subscription_id: id, shape_requests: requests},
        %State{} = state
      ) do
    cond do
      Utils.validate_uuid(id) != {:ok, id} ->
        {%SatSubsResp{
           subscription_id: id,
           err: %SatSubsError{message: "Subscription ID should be a valid UUID"}
         }, state}

      Utils.has_duplicates_by?(requests, & &1.request_id) ->
        {%SatSubsResp{
           subscription_id: id,
           err: %SatSubsError{message: "Duplicated request ids are not allowed"}
         }, state}

      true ->
        case Shapes.validate_requests(requests, Connectors.origin(state.pg_connector_opts)) do
          {:ok, requests} ->
            query_subscription_data(id, requests, state)

          {:error, errors} ->
            {%SatSubsResp{
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

  def process_message(%SatRelation{} = msg, %State{in_rep: in_rep} = state) do
    columns = Enum.map(msg.columns, fn %SatRelationColumn{} = x -> x.name end)

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
    self = self()

    try do
      case Serialization.deserialize_trans(
             state.client_id,
             msg,
             in_rep.incomplete_trans,
             in_rep.relations,
             fn lsn -> report_lsn(state.client_id, self, in_rep.sync_batch_size, lsn) end
           ) do
        {incomplete, []} ->
          {nil, %State{state | in_rep: %InRep{in_rep | incomplete_trans: incomplete}}}

        {incomplete, complete} ->
          complete = Enum.reverse(complete)

          in_rep =
            send_downstream(%InRep{
              in_rep
              | incomplete_trans: incomplete,
                queue:
                  Utils.add_events_to_queue(
                    complete,
                    in_rep.queue
                  )
            })

          {nil, %State{state | in_rep: in_rep}}
      end
    rescue
      e ->
        Logger.error(Exception.format(:error, e, __STACKTRACE__))
        {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}
    end
  end

  def process_message(%SatUnsubsReq{subscription_ids: ids}, %State{} = state) do
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
      {%SatUnsubsResp{}, state}
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

  defp handle_start_replication_request(%{subscription_ids: []} = msg, :start_from_first, state) do
    # This particular client is connecting for the first time, so it needs to perform
    # the initial sync before we start streaming any changes to it.
    #
    # Sending a message to self() here ensures that the SatInStartReplicationResp message is delivered to the
    # client first, followed by the initial migrations.
    send(self(), {:perform_initial_sync_and_subscribe, msg})
    {%SatInStartReplicationResp{}, state}
  end

  defp handle_start_replication_request(_msg, :start_from_first, _state) do
    {:error,
     start_replication_error(
       :INVALID_POSITION,
       "Cannot continue subscriptions while also starting from first LSN"
     )}
  end

  defp handle_start_replication_request(msg, :start_from_latest, state) do
    state = subscribe_client_to_replication_stream(state, msg, :start_from_latest)
    {%SatInStartReplicationResp{}, state}
  end

  defp handle_start_replication_request(msg, lsn, state) do
    if CachedWal.Api.lsn_in_cached_window?(lsn) do
      case restore_subscriptions(msg.subscription_ids, state) do
        {:ok, state} ->
          state = subscribe_client_to_replication_stream(state, msg, lsn)
          {%SatInStartReplicationResp{}, state}

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

  defp report_lsn(satellite, _pid, nil, lsn) do
    Logger.info("report lsn: #{inspect(lsn)} for #{satellite}")
    OffsetStorage.put_satellite_lsn(satellite, lsn)
    # We are not operating in a sync mode, so no need to acknowledge lsn in
    # this call
  end

  defp report_lsn(satellite, pid, 1, lsn) do
    Logger.info("report lsn: #{inspect(lsn)} for #{satellite}")
    OffsetStorage.put_satellite_lsn(satellite, lsn)
    Process.send(pid, {__MODULE__, :lsn_report, lsn}, [])
  end

  @spec handle_outgoing_txs([{Transaction.t(), term()}], State.t()) ::
          {[PB.sq_pb_msg()], State.t()}
  def handle_outgoing_txs(events, state, acc \\ [])

  def handle_outgoing_txs([{tx, offset} | events], %State{} = state, acc) do
    filtered_tx =
      tx
      |> maybe_strip_migration_ddl(state.out_rep.last_migration_xid_at_initial_sync)
      |> Shapes.filter_changes_from_tx(current_shapes(state))

    {out_rep, acc} =
      if filtered_tx.changes != [] and Changes.belongs_to_user?(filtered_tx, state.auth.user_id) do
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

  @spec subscribe_client_to_replication_stream(State.t(), %SatInStartReplicationReq{}, any()) ::
          State.t()
  def subscribe_client_to_replication_stream(state, msg, lsn) do
    Metrics.satellite_replication_event(%{started: 1})

    state
    |> maybe_setup_batch_counter(msg)
    |> initiate_subscription(lsn)
  end

  defp maybe_setup_batch_counter(
         %State{out_rep: out_rep} = state,
         %SatInStartReplicationReq{options: opts} = msg
       ) do
    if :SYNC_MODE in opts do
      sync_batch_size = msg.sync_batch_size
      true = sync_batch_size > 0
      out_rep = %OutRep{out_rep | sync_batch_size: sync_batch_size, sync_counter: sync_batch_size}
      %State{state | out_rep: out_rep}
    else
      state
    end
  end

  defp initiate_subscription(%State{out_rep: out_rep} = state, lsn) do
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

  def handle_subscription_data(id, data, state) do
    # TODO: in a perfect world there would be potential to stream out the changes instead of
    #       sending it all at once. It's quite hard to do with :ranch, or I haven't found a way.
    {relations, messages, state} =
      Enum.reduce(data, {[], [], state}, fn shape_data, {relations, messages, state} ->
        {new_relations, new_messages, out_rep} =
          handle_shape_request_data(shape_data, state.out_rep)

        {[new_relations | relations], [new_messages | messages], %{state | out_rep: out_rep}}
      end)

    {[
       relations,
       %SatSubsDataBegin{subscription_id: id},
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

  defp validate_schema_version(version) do
    if is_nil(version) or Extension.SchemaCache.known_migration_version?(version) do
      :ok
    else
      {:error, :bad_schema_version}
    end
  end

  defp validate_lsn(client_lsn, opts) do
    case {Enum.member?(opts, :FIRST_LSN), Enum.member?(opts, :LAST_LSN)} do
      {true, _} ->
        {:ok, :start_from_first}

      {_, true} ->
        {:ok, :start_from_latest}

      {false, false} ->
        case CachedWal.Api.parse_wal_position(client_lsn) do
          {:ok, value} -> {:ok, value}
          :error -> {:error, {:lsn_invalid, client_lsn}}
        end
    end
  end

  defp validate_headers([]), do: {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}
  defp validate_headers(nil), do: {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}

  defp validate_headers(headers) do
    headers =
      headers
      |> Enum.map(fn %SatAuthHeaderPair{key: key, value: value} -> {key, value} end)
      |> Map.new()

    with :ok <-
           require_header(headers, :PROTO_VERSION, :PROTO_VSN_MISMATCH, &compare_proto_version/1) do
      :ok
    else
      {:error, status} ->
        {:error, %SatErrorResp{error_type: status}}
    end
  end

  defp require_header(headers, header, error, cmp_fun) do
    case Map.get(headers, header) do
      nil ->
        {:error, error}

      value ->
        case cmp_fun.(value) do
          :ok -> :ok
          {:error, _} -> {:error, error}
        end
    end
  end

  defp compare_proto_version(client_proto_version) do
    with {:ok, server_vsn} <- PB.get_proto_vsn(),
         {:ok, client_vsn} <- PB.parse_proto_vsn(client_proto_version),
         true <- PB.is_compatible(server_vsn, client_vsn) do
      :ok
    else
      {:error, _} = e -> e
      false -> {:error, :not_compatible}
    end
  end

  defp current_shapes(%State{subscriptions: subscriptions, out_rep: out_rep}) do
    subscriptions
    |> Enum.reject(fn {id, _shapes} -> OutRep.subscription_pending?(id, out_rep) end)
    |> Enum.flat_map(fn {_, shapes} -> shapes end)
  end

  defp query_subscription_data(id, requests, %State{} = state) do
    ref = make_ref()
    parent = self()

    # I'm dereferencing these here because calling this in Task implies copying over entire `state` just for two fields.
    fun = state.subscription_data_fun
    opts = state.pg_connector_opts

    Task.start(fn ->
      # This is `InitiaSync.query_subscription_data/2` by default, but can be overridden for tests.
      # Please see documentation on that function for context on the next `receive` block.
      fun.({id, requests}, reply_to: {ref, parent}, connection: opts)
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

        {%SatSubsResp{subscription_id: id}, state}
    after
      1_000 ->
        {%SatSubsResp{
           subscription_id: id,
           err: %SatSubsError{message: "Internal error while checking data availability"}
         }, state}
    end
  end

  defp serialize_unknown_relations(unknown_relations) do
    Enum.map(
      unknown_relations,
      fn relation ->
        table_info = SchemaRegistry.fetch_table_info!(relation)
        columns = SchemaRegistry.fetch_table_columns!(relation)

        Serialization.serialize_relation(
          table_info,
          columns
        )
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
end
