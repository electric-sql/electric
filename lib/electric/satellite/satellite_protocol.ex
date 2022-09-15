defmodule Electric.Satellite.Protocol do
  @moduledoc """
  Protocol for communication with Satellite
  """
  require Logger

  alias Electric.Utils
  alias Electric.Satellite.PB.Utils, as: PB

  alias Electric.Satellite.{
    SatAuthReq,
    SatAuthResp,
    SatPingReq,
    SatPingResp,
    SatInStartReplicationReq,
    SatInStartReplicationResp,
    SatInStopReplicationReq,
    SatInStopReplicationResp,
    SatRelation,
    SatRelationColumn,
    SatOpLog,
    SatErrorResp
  }

  alias Electric.Replication.Changes.Transaction
  alias Electric.Postgres.SchemaRegistry
  alias Electric.Replication.Vaxine
  alias Electric.Replication.Changes
  alias Electric.Replication.OffsetStorage
  alias Electric.Satellite.Replication
  alias Electric.Satellite.ClientManager

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
    Incoming replication Satellite -> Vaxine
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
    Outgoing replication Vaxine -> Satellite
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
              last_msg_time: nil,
              client: nil,
              client_id: nil,
              in_rep: %InRep{},
              out_rep: %OutRep{},
              ping_tref: nil,
              transport: nil,
              socket: nil

    @type t() :: %__MODULE__{
            auth_passed: boolean(),
            last_msg_time: :erlang.timestamp() | nil | :ping_sent,
            client: String.t(),
            client_id: String.t() | nil,
            ping_tref: reference() | nil,
            transport: module(),
            socket: :ranch_transport.socket(),
            in_rep: InRep.t(),
            out_rep: OutRep.t()
          }
  end

  defguard auth_passed?(state) when state.auth_passed == true
  defguard in_rep?(state) when state.in_rep.status == :active
  defguard out_rep?(state) when state.out_rep.status == :active

  @spec process_message(PB.sq_pb_msg(), State.t()) ::
          {nil | :stop | PB.sq_pb_msg() | [PB.sq_pb_msg()], State.t()}
          | {:error, PB.sq_pb_msg()}
  def process_message(msg, %State{} = state)
      when not auth_passed?(state) do
    case msg do
      %SatAuthReq{id: id, token: token}
      when id !== "" and token !== "" ->
        Logger.debug("Received auth request #{inspect(state.client)} for #{inspect(id)}")

        with :ok <- Electric.Satellite.Auth.validate_token(id, token) do
          reg_name = Electric.Satellite.WsServer.reg_name(state.client)
          Electric.reg(reg_name)
          :ok = ClientManager.register_client(state.client, reg_name)

          {%SatAuthResp{id: "server_identity"}, %State{state | auth_passed: true, client_id: id}}
        else
          {:error, _} ->
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

  # Satelite client request replication
  def process_message(
        %SatInStartReplicationReq{lsn: client_lsn, options: opts} = msg,
        %State{in_rep: _in_rep, out_rep: out_rep} = state
      )
      when client_lsn !== "" do
    # FIXME: only sync_batch_size == 1 is supported in SYNC_MODE at the moment
    out_rep =
      case Enum.member?(opts, :SYNC_MODE) do
        true ->
          sync_batch_size = msg.sync_batch_size
          true = sync_batch_size > 0
          %OutRep{out_rep | sync_batch_size: sync_batch_size, sync_counter: sync_batch_size}

        false ->
          # No confirmation
          out_rep
      end

    Logger.debug(
      "Recieved start replication request lsn: #{inspect(client_lsn)} with options: #{inspect(opts)}"
    )

    out_rep = initiate_subscription(state.client, client_lsn, out_rep)
    {[%SatInStartReplicationResp{}], %State{state | out_rep: out_rep}}
  end

  # Satelite client confirms replication start
  def process_message(%SatInStartReplicationResp{} = _msg, %State{} = state) do
    Logger.debug("Recieved start replication response")

    case state.in_rep.status do
      :requested ->
        {nil, %State{state | in_rep: %InRep{state.in_rep | status: :active}}}

      :paused ->
        # Could be when vaxine is temporary unavailable
        {%SatInStopReplicationReq{}, state}
    end
  end

  # Satelite requests to stop replication
  def process_message(%SatInStopReplicationReq{} = _msg, %State{out_rep: out_rep} = state)
      when out_rep?(state) do
    Logger.debug("Received stop replication request")
    # FIXME: We do not know whether the client intend to start from last LSN, or
    # optional lsn, so we should just restart producer if the client would
    # request different LSN than we are about to send.
    out_rep = terminate_subscription(out_rep)
    {%SatInStopReplicationResp{}, %State{state | out_rep: out_rep}}
  end

  # Satellite confirms replication stop
  def process_message(%SatInStopReplicationResp{} = _msg, state) do
    Logger.debug("Received stop replication response")

    in_rep = %InRep{state.in_rep | status: nil}
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
      case Replication.deserialize_trans(
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

  # Transactions coming from Vaxine
  @spec handle_out_trans([{Transaction.t(), term()}], State.t()) ::
          {[PB.sq_pb_msg()], State.t()}
  def handle_out_transes(events, state, acc \\ [])

  def handle_out_transes([event | events], state, acc) do
    {relations, transaction, out_rep} = handle_out_trans(event, state)
    acc = [transaction | relations] ++ acc
    handle_out_transes(events, %State{state | out_rep: out_rep}, acc)
  end

  def handle_out_transes([], state, acc) do
    {Enum.reverse(acc), state}
  end

  @spec handle_out_trans({Transaction.t(), any}, State.t()) ::
          {[%SatRelation{}], %SatOpLog{}, OutRep.t()}
  def handle_out_trans({trans, vx_offset}, %State{out_rep: out_rep}) do
    Logger.debug("trans: #{inspect(trans)} with offset #{inspect(vx_offset)}")

    {serialized_log, unknown_relations, known_relations} =
      Replication.serialize_trans(trans, vx_offset, out_rep.relations)

    serialized_relations =
      Enum.map(
        unknown_relations,
        fn relation ->
          table_info = SchemaRegistry.fetch_table_info!(relation)
          columns = SchemaRegistry.fetch_table_columns!(relation)

          Replication.serialize_relation(
            table_info.schema,
            table_info.name,
            table_info.oid,
            columns
          )
        end
      )

    Logger.debug("relations: #{inspect(unknown_relations)}")
    out_rep = %OutRep{out_rep | relations: known_relations}

    {serialized_relations, serialized_log, out_rep}
  end

  @spec initiate_subscription(String.t(), binary, OutRep.t()) :: OutRep.t()
  def initiate_subscription(client, lsn, out_rep)
      when is_binary(lsn) do
    lsn =
      case lsn do
        "eof" -> :eof
        "0" -> 0
        _ -> :erlang.binary_to_term(lsn)
      end

    {:via, :gproc, vaxine_producer} = Vaxine.LogProducer.get_name(client)
    {sub_pid, _} = :gproc.await(vaxine_producer, @producer_timeout)
    sub_ref = Process.monitor(sub_pid)

    opts = [{:to, sub_pid}, {:start_subscription, lsn}, {:min_demand, 5}, {:max_demand, 10}]
    msg = {:"$gen_producer", {self(), sub_ref}, {:subscribe, nil, opts}}

    Process.send(sub_pid, msg, [])
    ask({sub_pid, sub_ref}, @producer_demand)

    %OutRep{out_rep | pid: sub_pid, status: :active, stage_sub: sub_ref}
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
end
