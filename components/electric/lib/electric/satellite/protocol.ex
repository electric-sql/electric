defmodule Electric.Satellite.Protocol do
  @moduledoc """
  Protocol for communication with Satellite
  """
  require Logger

  alias Electric.Postgres.CachedWal.Producer
  alias Electric.Utils
  use Electric.Satellite.Protobuf

  alias Electric.Replication.Changes.Transaction
  alias Electric.Postgres.SchemaRegistry
  alias Electric.Replication.Changes
  alias Electric.Replication.OffsetStorage
  alias Electric.Satellite.Serialization
  alias Electric.Satellite.ClientManager
  alias Electric.Telemetry.Metrics

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
              sync_batch_size: nil

    @typedoc """
    Outgoing replication PG -> Satellite
    """
    @type t() :: %__MODULE__{
            pid: pid() | nil,
            lsn: String.t(),
            status: nil | :active,
            stage_sub: GenStage.subscription_tag() | nil,
            relations: %{Changes.relation() => PB.relation_id()},
            # Parameters used to acknowledge received messages
            sync_batch_size: nil | non_neg_integer,
            sync_counter: nil | non_neg_integer()
          }
  end

  defmodule State do
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
              pg_connector_opts: []

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
            pg_connector_opts: Keyword.t()
          }
  end

  defguard auth_passed?(state) when state.auth_passed == true
  defguard in_rep?(state) when state.in_rep.status == :active
  defguard out_rep?(state) when state.out_rep.status == :active

  @spec process_message(PB.sq_pb_msg(), State.t()) ::
          {nil | :stop | PB.sq_pb_msg() | [PB.sq_pb_msg()], State.t()}
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

          {%SatAuthResp{id: Electric.regional_id()},
           %State{state | auth: auth, auth_passed: true, client_id: client_id}}
        else
          {:error, %SatErrorResp{}} = error ->
            error

          {:error, %Electric.Satellite.Auth.TokenError{message: message}} ->
            Logger.warn("client authorization failed",
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
    case validate_lsn(client_lsn, opts) do
      {:ok, :start_from_first} ->
        # This particular client is connecting for the first time, so it needs to perform
        # the initial sync before we start streaming any changes to it.
        #
        # Sending a message to self() here ensures that the SatInStartReplicationResp message is delivered to the
        # client first, followed by the initial migrations and data.
        send(self(), :perform_initial_sync_and_subscribe)
        {[%SatInStartReplicationResp{}], state}

      {:ok, lsn} ->
        state =
          state
          |> maybe_setup_batch_counter(msg)
          |> initiate_subscription(lsn)

        Logger.debug(
          "Received start replication request lsn: #{inspect(client_lsn)} with options: #{inspect(opts)}"
        )

        Metrics.satellite_replication_event(%{started: 1})

        {[%SatInStartReplicationResp{}], state}

      {:error, reason} ->
        Logger.warn("Bad start replication options: #{inspect(reason)}")
        {:error, %SatErrorResp{error_type: :INVALID_REQUEST}}
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
      when out_rep?(state) do
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

  def handle_outgoing_txs([{tx, _offset} = event | events], state, acc) do
    if Changes.belongs_to_user?(tx, state.auth.user_id) do
      {relations, transaction, out_rep} = handle_out_trans(event, state)
      acc = Enum.concat([transaction, relations, acc])
      handle_outgoing_txs(events, %State{state | out_rep: out_rep}, acc)
    else
      Logger.debug("Filtering transaction #{inspect(tx)} for user #{state.auth.user_id}")

      handle_outgoing_txs(events, state, acc)
    end
  end

  def handle_outgoing_txs([], state, acc) do
    {Enum.reverse(acc), state}
  end

  # The offset here comes from the producer
  @spec handle_out_trans({Transaction.t(), any}, State.t()) ::
          {[%SatRelation{}], [%SatOpLog{}], OutRep.t()}
  def handle_out_trans({trans, offset}, %State{out_rep: out_rep}) do
    Logger.debug("trans: #{inspect(trans)} with offset #{inspect(offset)}")

    {serialized_log, unknown_relations, known_relations} =
      Serialization.serialize_trans(trans, offset, out_rep.relations)

    serialized_relations =
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

    Logger.debug("relations: #{inspect(unknown_relations)}")
    out_rep = %OutRep{out_rep | relations: known_relations}

    {serialized_relations, serialized_log, out_rep}
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

  @spec initiate_subscription(State.t(), any()) :: State.t()
  def initiate_subscription(%State{out_rep: out_rep} = state, lsn) do
    {:via, :gproc, producer} = Producer.name(state.client_id)
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

    out_rep = %OutRep{out_rep | pid: sub_pid, status: :active, stage_sub: sub_ref}
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

  defp validate_lsn(client_lsn, opts) do
    case {Enum.member?(opts, :FIRST_LSN), Enum.member?(opts, :LAST_LSN)} do
      {true, _} ->
        {:ok, :start_from_first}

      {_, true} ->
        {:ok, :start_from_latest}

      {false, false} ->
        case Electric.Postgres.CachedWal.Api.parse_wal_position(client_lsn) do
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
           require_header(headers, :PROTO_VERSION, :PROTO_VSN_MISSMATCH, &compare_proto_version/1) do
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
end
