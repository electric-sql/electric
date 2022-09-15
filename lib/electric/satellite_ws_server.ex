defmodule Electric.Satellite.WsServer do
  alias Electric.Satellite.Protocol
  alias Electric.Satellite.Protocol.{State, InRep, OutRep}

  alias Electric.Satellite.PB.Utils, as: PB

  alias Electric.Satellite.{
    SatErrorResp,
    SatPingResp,
    SatInStopReplicationReq,
    SatInStartReplicationReq
  }

  import Protocol, only: [out_rep?: 1]

  require Logger

  # in milliseconds
  @inactivity_timeout 10_000_000

  def child_spec(opts) do
    %{id: __MODULE__, start: {__MODULE__, :start_link, [opts]}}
  end

  @spec start_link(port: pos_integer()) :: {:ok, pid()} | {:error, any()}
  def start_link(opts) do
    port = Keyword.fetch!(opts, :port)

    dispatch =
      :cowboy_router.compile([
        {:_, [{"/ws", __MODULE__, []}]}
      ])

    :cowboy.start_clear(:ws, [{:port, port}], %{
      :env => %{dispatch: dispatch},
      :idle_timeout => @inactivity_timeout
    })
  end

  def reg_name(name) do
    {:via, :gproc, name(name)}
  end

  def name(name) do
    {:n, :l, {__MODULE__, name}}
  end

  def init(req, _opts) do
    # FIXME: If we itend to use headers to do authentification
    # we shoul do it here. For now we purely rely on protobuff auth
    # messages
    {ip, port} = :cowboy_req.peer(req)
    client = "#{:inet.ntoa(ip)}:#{port}"

    {:cowboy_websocket, req, %State{client: client}}
  end

  def websocket_init(%State{client: client} = state) do
    # NOTE: Be carefull with registration, init and websocket_init are called
    # in different processes in cowboy 2.9
    :gproc.reg(name(client))

    Logger.metadata(sq_client: client)
    Logger.debug("Satellite ws connection initialized by #{client}")

    {[], state}
  end

  def websocket_handle({:binary, msg}, %State{} = state) do
    case handle_data(msg) do
      {:ok, request} ->
        Logger.warn("ws data received: #{inspect(request)}")

        case Protocol.process_message(request, state) do
          {nil, state1} ->
            {[], state1}

          {:error, error} ->
            frame = binary_frame(error)
            {[frame, :close], state}

          {:stop, state} ->
            {[:close], state}

          {reply, state1} ->
            {binary_frames(reply), state1}
        end

      {:error, error} ->
        Logger.error("ws data corrupted: #{inspect(error)}")
        {[binary_frame(%SatErrorResp{}), :close], state}
    end
  end

  def websocket_info({:"$gen_consumer", from, msg}, state) do
    Logger.warn("msg from producer: #{inspect(msg)}")
    handle_producer_msg(from, msg, state)
  end

  def websocket_info({:"$gen_producer", from, msg}, state) do
    Logger.warn("msg from consumer: #{inspect(msg)}")
    handle_consumer_msg(from, msg, state)
  end

  def websocket_info({:DOWN, _ref, :process, pid, _reason}, %State{in_rep: in_rep} = state)
      when in_rep.pid == pid do
    handle_consumer_msg({in_rep.pid, in_rep.stage_sub}, {:cancel, :down}, state)
  end

  def websocket_info({:DOWN, _ref, :process, pid, _reason}, %State{out_rep: out_rep} = state)
      when out_rep.pid == pid do
    # FIXME: Check if it's the provider that failed, or consumer and
    # act accordingly
    handle_producer_msg({out_rep.pid, out_rep.stage_sub}, {:cancel, :down}, state)
  end

  def websocket_info({Protocol, :lsn_report, lsn}, %State{} = state) do
    {[binary_frame(%SatPingResp{lsn: lsn})], state}
  end

  def websocket_info(msg, state) do
    # There might be a race between DOWN message from consumer and following
    # attempt to subscribe, so it's ok to receive down messages here on some
    # occasion
    Logger.warn("Unhandled msg ws connection: #{inspect(msg)}")
    {[], state}
  end

  # -------------------------------------------------------------------------------

  # Messages coming from producer
  @spec handle_producer_msg(
          GenStage.from(),
          {:cancel, term()} | [term()],
          State.t()
        ) :: {list(), State.t()}
  def handle_producer_msg(
        {_pid, _sub_tag},
        {:cancel, reason},
        %State{out_rep: %OutRep{} = out_rep} = state
      ) do
    Logger.warn("log producer canceled subscription: #{inspect(reason)}")

    {[binary_frame(%SatErrorResp{})],
     %State{state | out_rep: %OutRep{out_rep | pid: nil, stage_sub: nil}}}
  end

  def handle_producer_msg(from, [_ | _] = events, %State{out_rep: out_rep} = state)
      when out_rep?(state) do
    case from == {out_rep.pid, out_rep.stage_sub} do
      true ->
        GenStage.ask(from, 1)

        case Protocol.handle_out_transes(events, state) do
          {[], state} ->
            {[], state}

          {msgs, state} ->
            {binary_frames(msgs), state}
        end

      false ->
        {[], state}
    end
  end

  def handle_producer_msg(_from, _events, %State{out_rep: _out_rep} = state) do
    # Ignore messages, as subscription is not active
    {[], state}
  end

  # Messages coming from consumer
  @spec handle_consumer_msg(
          {pid(), reference()},
          {:ask, pos_integer()} | {:cancel, any} | {:subscribe, any, any},
          State.t()
        ) :: {[{:binary, iodata()}], State.t()}
  def handle_consumer_msg(
        {pid, sub_tag},
        {:subscribe, _current, _options},
        %State{in_rep: in_rep} = state
      ) do
    # Subscription is either initial subscription, or restart of the consumer
    case in_rep.pid do
      nil -> Process.monitor(pid)
      ^pid -> :ok
      pid -> Process.monitor(pid)
    end

    msgs =
      cond do
        in_rep.status == nil or in_rep.status == :paused ->
          [
            %SatInStartReplicationReq{
              options: [:LAST_ACKNOWLEDGED, :SYNC_MODE],
              sync_batch_size: 1
            }
          ]

        in_rep.status == :active ->
          [
            %SatInStopReplicationReq{},
            %SatInStartReplicationReq{
              options: [:LAST_ACKNOWLEDGED, :SYNC_MODE],
              sync_batch_size: 1
            }
          ]

        in_rep.status == :requested ->
          []
      end

    in_rep = %InRep{
      in_rep
      | stage_sub: sub_tag,
        pid: pid,
        status: :requested,
        sync_batch_size: 1,
        sync_counter: 0
    }

    {Enum.map(msgs, fn x -> binary_frame(x) end), %State{state | in_rep: in_rep}}
  end

  # Gen consumer cancels subscription, may only happen for subscribed consumer
  def handle_consumer_msg(
        {pid, sub_tag},
        {:cancel, _reason},
        %State{in_rep: %InRep{pid: pid, stage_sub: sub_tag} = in_rep} = state
      ) do
    # status == :nil is not possible, as it is set to pause once we have consumer
    maybe_stop =
      case in_rep.status do
        :active -> [binary_frame(%SatInStopReplicationReq{})]
        :paused -> []
        :requested -> [binary_frame(%SatInStopReplicationReq{})]
      end

    in_rep = %InRep{state.in_rep | queue: :queue.new(), pid: nil, stage_sub: nil, status: :paused}
    {maybe_stop, %State{state | in_rep: in_rep}}
  end

  # Gen consumer asks for another portion of data may only happen for subscribed consumer
  def handle_consumer_msg(
        {pid, sub_tag},
        {:ask, demand},
        %State{in_rep: %InRep{pid: pid, stage_sub: sub_tag} = in_rep} = state
      ) do
    case in_rep.status do
      :active ->
        {[], %State{state | in_rep: Protocol.send_downstream(state.in_rep)}}

      st
      when st == :requested or
             st == :paused ->
        {[], %State{state | in_rep: %InRep{in_rep | demand: demand + in_rep.demand}}}
    end
  end

  @spec handle_data(binary) :: {:error, term} | {:ok, PB.sq_pb_msg()}
  defp handle_data(data) do
    try do
      <<msg_type::8, msg_data::binary>> = data
      PB.decode(msg_type, msg_data)
    catch
      _ -> {:error, :unknown_msg_type}
    end
  end

  defp binary_frames(pb_msgs) when is_list(pb_msgs) do
    Enum.map(pb_msgs, fn pb_msg -> binary_frame(pb_msg) end)
  end

  defp binary_frames(pb_msg) do
    [binary_frame(pb_msg)]
  end

  defp binary_frame(pb_msg) do
    Logger.debug("Responding with: #{inspect(pb_msg)}")
    {:ok, iolist} = PB.encode_with_type(pb_msg)
    {:binary, iolist}
  end
end
