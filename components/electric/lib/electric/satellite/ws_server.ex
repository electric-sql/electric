defmodule Electric.Satellite.WsServer do
  require Pathex
  alias Electric.Utils
  alias Electric.Replication.InitialSync
  alias Electric.Satellite.Protocol
  alias Electric.Satellite.Protocol.{State, InRep, OutRep}
  alias Electric.Replication.OffsetStorage

  use Pathex, default_mod: :map
  use Electric.Satellite.Protobuf

  import Protocol, only: :macros

  require Logger

  # in milliseconds
  @ping_interval 5_000
  @inactivity_timeout 10_000_000

  def child_spec(opts) do
    %{id: __MODULE__, start: {__MODULE__, :start_link, [opts]}}
  end

  @spec start_link(port: pos_integer()) :: {:ok, pid()} | {:error, any()}
  def start_link(opts) do
    port = Keyword.fetch!(opts, :port)
    # cowboy requires a unique name. so allow for configuration for test servers
    name = Keyword.get(opts, :name, :ws)
    auth_provider = Keyword.fetch!(opts, :auth_provider)

    opts = Keyword.put_new(opts, :subscription_data_fun, &InitialSync.query_subscription_data/2)

    Logger.debug(
      "Starting WS server #{inspect(name)} on port #{port} with auth provider: #{inspect(elem(auth_provider, 0))}"
    )

    dispatch =
      :cowboy_router.compile([
        {:_,
         [
           {"/ws", __MODULE__,
            Keyword.take(opts, [:auth_provider, :pg_connector_opts, :subscription_data_fun])}
         ]}
      ])

    :cowboy.start_clear(name, [port: port], %{
      :env => %{dispatch: dispatch},
      :idle_timeout => @inactivity_timeout
    })
  end

  def reg_name(name) do
    Electric.name(__MODULE__, name)
  end

  def init(req, opts) do
    # NOTE: If we intend to use headers to do authentification
    # we should do it here. For now we purely rely on protobuf auth
    # messages
    {ip, port} = :cowboy_req.peer(req)
    client = "#{:inet.ntoa(ip)}:#{port}"
    auth_provider = Keyword.fetch!(opts, :auth_provider)
    pg_connector_opts = Keyword.fetch!(opts, :pg_connector_opts)
    subscription_data_fun = Keyword.fetch!(opts, :subscription_data_fun)

    # Add the cluster id to the logger metadata to make filtering easier in the case of global log
    # aggregation
    Logger.metadata(instance_id: Electric.instance_id(), regional_id: Electric.regional_id())

    {:cowboy_websocket, req,
     %State{
       client: client,
       last_msg_time: :erlang.timestamp(),
       auth_provider: auth_provider,
       pg_connector_opts: pg_connector_opts,
       subscription_data_fun: subscription_data_fun
     }}
  end

  def websocket_init(%State{client: client} = state) do
    # NOTE: Be careful with registration, init and websocket_init are called
    # in different processes in cowboy 2.9

    Logger.metadata(sq_client: client)
    Logger.debug("Satellite ws connection initialized by #{client}")

    {[], schedule_ping(state)}
  end

  def websocket_handle({:binary, msg}, %State{} = state) do
    last_msg_time = :os.timestamp()

    case handle_data(msg) do
      {:ok, request} ->
        Logger.debug("ws data received: #{inspect(request)}")

        try do
          case Protocol.process_message(request, state) do
            {nil, state1} ->
              {[], %State{state1 | last_msg_time: last_msg_time}}

            {:error, error} ->
              frame = binary_frame(error)
              {[frame, :close], state}

            {:stop, state} ->
              {[:close], state}

            {reply, state1} ->
              {binary_frames(reply), %State{state1 | last_msg_time: last_msg_time}}
          end
        rescue
          e ->
            Logger.error("""
            #{Exception.format(:error, e, __STACKTRACE__)}
            While handling message from the client:
            #{String.replace(inspect(request, pretty: true), ~r/^/m, "  ")}"
            """)

            frame = binary_frame(%SatErrorResp{})
            {[frame, :close], state}
        end

      {:error, error} ->
        Logger.error("ws data corrupted: #{inspect(error)}")
        {[binary_frame(%SatErrorResp{}), :close], state}
    end
  end

  def websocket_info({:"$gen_consumer", from, msg}, state) do
    Logger.debug("msg from producer: #{inspect(msg)}")
    handle_producer_msg(from, msg, state)
  end

  def websocket_info({:"$gen_producer", from, msg}, state) do
    Logger.debug("msg from consumer: #{inspect(msg)}")
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

  def websocket_info({:timeout, tref, :ping_timer}, %State{ping_tref: tref1} = state)
      when tref == tref1 do
    case state.last_msg_time do
      nil ->
        {[binary_frame(%SatPingReq{})],
         schedule_ping(%State{state | ping_tref: nil, last_msg_time: :ping_sent})}

      :ping_sent ->
        Logger.info("Client is not responding to ping, disconnecting")
        {[:close], state}

      last_msg_time ->
        case :timer.now_diff(:erlang.timestamp(), last_msg_time) >
               @ping_interval * 1000 do
          true ->
            {[binary_frame(%SatPingReq{})],
             schedule_ping(%State{state | ping_tref: nil, last_msg_time: :ping_sent})}

          false ->
            {[], schedule_ping(%State{state | ping_tref: nil})}
        end
    end
  end

  # Consumer (SatelliteCollectorConsumer) has reported that this lsn has been stored successfully
  # and as long as %InRep.sync_batch_size is enabled we need to report to Satellite.
  def websocket_info({Protocol, :lsn_report, lsn}, %State{} = state) do
    {[binary_frame(%SatPingResp{lsn: lsn})], state}
  end

  # While processing the SatInStartReplicationReq message, Protocol has determined that a new
  # client has connected which needs to perform the initial sync of migrations and the current database state before
  # subscribing to the replication stream.
  def websocket_info(:perform_initial_sync_and_subscribe, %State{} = state) do
    {lsn, transactions} = Electric.Replication.InitialSync.transactions(state.pg_connector_opts)
    {msgs, state} = Protocol.handle_outgoing_txs(transactions, state)
    state = Protocol.initiate_subscription(state, lsn)
    {binary_frames(msgs), state}
  end

  def websocket_info({:subscription_data, subscription_id, _, data}, %State{} = state)
      when is_out_rep_paused(state) and is_pending_subscription(state, subscription_id) do
    Logger.debug(
      "Received initial data for subscription #{subscription_id} while paused waiting for it"
    )

    send_subscription_data_and_unpause(subscription_id, data, state)
    |> binary_frames()
  end

  def websocket_info({:subscription_data, subscription_id, _, data}, %State{} = state)
      when is_out_rep_paused(state) do
    Logger.debug(
      "Received initial data for subscription #{subscription_id} while paused waiting for a different subscription"
    )

    {[], %{state | out_rep: OutRep.store_subscription_data(state.out_rep, subscription_id, data)}}
  end

  def websocket_info({:subscription_data, subscription_id, observed_pos, data}, %State{} = state) do
    Logger.debug(
      "Received initial data for subscription #{subscription_id} while stream ongoing. Stream position is #{state.out_rep.last_seen_wal_pos}, observed subscription position is #{observed_pos}"
    )

    if state.out_rep.last_seen_wal_pos == observed_pos do
      # Between us requesting the data and receiving the data no transactions actually reached this stage, meaning we can safely send the data right now
      send_subscription_data_and_unpause(subscription_id, data, state)
      |> binary_frames()
    else
      # Stream hasn't reached the tx yet (otherwise it would be paused), so we're going to save the data
      {[],
       %{state | out_rep: OutRep.store_subscription_data(state.out_rep, subscription_id, data)}}
    end
  end

  def websocket_info({:subscription_init_failed, subscription_id, reason}, state) do
    Logger.error(
      "Couldn't retrieve initial data for subscription #{subscription_id}, with reason #{inspect(reason)}"
    )

    error = %SatSubsDataError{
      subscription_id: subscription_id,
      message: "Could not retrieve initial data for subscription"
    }

    # In any case we need to remove the subscription itself since it'll
    state
    |> Map.update!(:subscriptions, &Map.delete(&1, subscription_id))
    |> case do
      state when is_out_rep_paused(state) and is_pending_subscription(state, subscription_id) ->
        # We're paused on this, we want to send the error and unpause
        error
        |> send_subscription_data_error_and_unpause(state)
        |> binary_frames()

      state ->
        # We're either paused on smth else, or replication is stopped, or replication is ongoing
        # In any case, we just remove the "future" pause point and notify the client
        # We remove the pause point and notify the client
        {binary_frames(error),
         %{state | out_rep: OutRep.remove_pause_point(state.out_rep, subscription_id)}}
    end
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
    Logger.debug("log producer canceled subscription: #{inspect(reason)}")

    {[binary_frame(%SatErrorResp{})],
     %State{state | out_rep: %OutRep{out_rep | pid: nil, stage_sub: nil}}}
  end

  def handle_producer_msg(from, [_ | _], %State{out_rep: out_rep} = state)
      when from != {out_rep.pid, out_rep.stage_sub} do
    # We're not subscribed to this, let's drop it
    {[], state}
  end

  def handle_producer_msg(from, [_ | _] = events, %State{} = state)
      when is_out_rep_active(state) do
    GenStage.ask(from, 1)

    send_events_and_maybe_pause(events, state)
    |> binary_frames()
  end

  def handle_producer_msg(from, [_ | _] = events, %State{} = state)
      when is_out_rep_paused(state) do
    GenStage.ask(from, 1)
    {[], %{state | out_rep: OutRep.add_events_to_buffer(state.out_rep, events)}}
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

    lsn =
      case OffsetStorage.get_satellite_lsn(state.client_id) do
        nil -> ""
        lsn -> lsn
      end

    msgs =
      cond do
        in_rep.status == nil or in_rep.status == :paused ->
          [
            %SatInStartReplicationReq{
              options: [:SYNC_MODE],
              sync_batch_size: 1,
              lsn: lsn
            }
          ]

        in_rep.status == :active ->
          [
            %SatInStopReplicationReq{},
            %SatInStartReplicationReq{
              options: [:SYNC_MODE],
              sync_batch_size: 1,
              lsn: lsn
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

  defp binary_frames({pb_msg, %State{} = state}), do: {binary_frames(pb_msg), state}
  defp binary_frames(pb_msg) when not is_list(pb_msg), do: [binary_frame(pb_msg)]
  defp binary_frames(msgs), do: Utils.flatten_map(msgs, &binary_frame/1)

  defp binary_frame(pb_msg) do
    Logger.debug("Responding with: #{inspect(pb_msg)}")
    {:ok, iolist} = PB.encode_with_type(pb_msg)
    {:binary, iolist}
  end

  defp schedule_ping(%State{ping_tref: nil} = state) do
    tref = :erlang.start_timer(@ping_interval, self(), :ping_timer)
    %State{state | ping_tref: tref}
  end

  defp send_events_and_maybe_pause(events, %State{} = state)
       when no_pending_subscriptions(state) do
    Protocol.handle_outgoing_txs(events, state)
  end

  defp send_events_and_maybe_pause(events, %State{out_rep: out_rep} = state) do
    {{xmin, subscription_id}, _} = out_rep.subscription_pause_queue

    case Enum.split_while(events, fn {tx, _} -> tx.xid < xmin end) do
      {events, []} ->
        # We haven't yet reached the pause point
        Protocol.handle_outgoing_txs(events, state)

      {events, pending} ->
        # We've reached the pause point, but we may have some messages we can send
        {msgs, state} = Protocol.handle_outgoing_txs(events, state)

        state =
          state.out_rep
          |> OutRep.add_events_to_buffer(pending)
          |> OutRep.set_status(:paused)
          |> then(&%{state | out_rep: &1})

        case Pathex.pop(state, path(:out_rep / :subscription_data_to_send / subscription_id)) do
          {:ok, {data, state}} ->
            send_subscription_data_and_unpause(msgs, subscription_id, data, state)

          :error ->
            {msgs, state}
        end
    end
  end

  defp send_subscription_data_and_unpause(msgs \\ [], id, data, state) do
    buffer = state.out_rep.outgoing_ops_buffer

    state =
      state.out_rep
      |> OutRep.remove_next_pause_point()
      |> OutRep.set_event_buffer([])
      |> OutRep.set_status(:active)
      |> then(&%{state | out_rep: &1})

    {more_msgs, state} = Protocol.handle_subscription_data(id, data, state)

    {even_more_msgs, state} =
      buffer
      |> :queue.to_list()
      |> send_events_and_maybe_pause(state)

    {[msgs, more_msgs, even_more_msgs], state}
  end

  defp send_subscription_data_error_and_unpause(error, state) do
    buffer = state.out_rep.outgoing_ops_buffer

    state =
      state.out_rep
      |> OutRep.remove_next_pause_point()
      |> OutRep.set_event_buffer([])
      |> OutRep.set_status(:active)
      |> then(&%{state | out_rep: &1})

    {rest_of_msgs, state} =
      buffer
      |> :queue.to_list()
      |> send_events_and_maybe_pause(state)

    {[error, rest_of_msgs], state}
  end
end
