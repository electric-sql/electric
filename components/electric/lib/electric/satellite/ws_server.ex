defmodule Electric.Satellite.WebsocketServer do
  @moduledoc """
  WebSock handler that speaks Satellite protocol.

  This module is responsible for handling the replication going to Satellite
  instances, and coming from them. Most of actual logic is in a separate module,
  `Electric.Satellite.Protocol` (but this is still the same process as this server),
  which actually forms responses for messages.

  ## Replication from Electric to Satellites

  The websocket server implements a GenStage consumer message interface, and when
  Satellite connects to the server, the server connects to a GenStage producer to get
  transactions to be sent to the client.

  ## Replication from Satellite to Electric

  When the connection is established with Satellite, a separate process is spawned, which
  is a GenStage consumer. That consumer subscribes to this websocket server - the server
  implements a GenStage producer message interface as well. As soon as that consumer is
  subscribed, websocket server sends a request to Satellite telling it to start replication.
  Anything coming from Satellite is then sent to the consumer, and any persistence concerns
  are out of scope of this process.
  """

  @behaviour WebSock

  require Logger
  use Pathex, default_mod: :map

  use Electric.Satellite.Protobuf
  import Electric.Satellite.Protocol, only: :macros

  alias Electric.Utils
  alias Electric.Postgres.CachedWal
  alias Electric.Replication.InitialSync
  alias Electric.Satellite.Protocol
  alias Electric.Satellite.Protocol.State
  alias Electric.Satellite.Protocol.OutRep
  alias Electric.Satellite.Protocol.InRep

  # in milliseconds
  @ping_interval 5_000

  def reg_name(name) do
    Electric.name(__MODULE__, name)
  end

  @impl WebSock
  def init(opts) do
    {:ok,
     schedule_ping(%State{
       last_msg_time: :erlang.timestamp(),
       auth_provider: Keyword.fetch!(opts, :auth_provider),
       pg_connector_opts: Keyword.fetch!(opts, :pg_connector_opts),
       subscription_data_fun: Keyword.fetch!(opts, :subscription_data_fun)
     })}
  end

  @impl WebSock
  def handle_in({data, opcode: :binary}, state) do
    with <<msg_type::8, msg_data::binary>> <- data,
         {:ok, msg} <- PB.decode(msg_type, msg_data) do
      Logger.debug("ws data received: #{inspect(msg)}")
      process_message(msg, state)
    else
      error ->
        Logger.error("Client sent corrupted WS data: #{inspect(error)} (data #{inspect(data)})")

        {:stop, :normal, {1007, "Message not formatted according to Electric protocol"},
         binary_frame(%SatErrorResp{}), state}
    end
  end

  @spec process_message(PB.sq_pb_msg(), State.t()) :: WebSock.handle_result()
  defp process_message(msg, %State{} = state) do
    last_msg_time = :erlang.timestamp()

    case Protocol.process_message(msg, %State{state | last_msg_time: last_msg_time}) do
      {:stop, state} -> {:stop, :normal, state}
      {:error, error} -> {:stop, :normal, 1007, binary_frames(error), state}
      {nil, state} -> {:ok, state}
      {reply, state} -> push({reply, state})
      {:force_unpause, reply, state} -> push(unpause_and_send_pending_events([reply], state))
    end
  rescue
    e ->
      Logger.error("""
      #{Exception.format(:error, e, __STACKTRACE__)}
      While handling message from the client:
      #{String.replace(inspect(msg, pretty: true), ~r/^/m, "  ")}"
      """)

      {:stop, e, {1011, "Failed to process message"}, binary_frame(%SatErrorResp{}), state}
  end

  @impl WebSock
  # Either a `:ping` or a `:pong` message are enough to keep the connection open
  def handle_control(_, %State{} = state) do
    last_msg_time = :erlang.timestamp()
    {:ok, %State{state | last_msg_time: last_msg_time}}
  end

  @impl WebSock
  # These four `handle_info` cases allow this websocket to act as a GenStage consumer and producer
  def handle_info({:"$gen_consumer", from, msg}, state) do
    Logger.debug("msg from producer: #{inspect(msg)}")
    handle_producer_msg(from, msg, state)
  end

  def handle_info({:"$gen_producer", from, msg}, state) do
    Logger.debug("msg from consumer: #{inspect(msg)}")
    handle_consumer_msg(from, msg, state)
  end

  def handle_info({:DOWN, _ref, :process, pid, _reason}, %State{in_rep: in_rep} = state)
      when in_rep.pid == pid do
    handle_consumer_msg({in_rep.pid, in_rep.stage_sub}, {:cancel, :down}, state)
  end

  def handle_info({:DOWN, _ref, :process, pid, _reason}, %State{out_rep: out_rep} = state)
      when out_rep.pid == pid do
    # FIXME: Check if it's the provider that failed, or consumer and
    # act accordingly
    handle_producer_msg({out_rep.pid, out_rep.stage_sub}, {:cancel, :down}, state)
  end

  def handle_info({:timeout, :ping_timer}, %State{} = state) do
    case state.last_msg_time do
      :ping_sent ->
        Logger.info("Client is not responding to ping, disconnecting")
        {:stop, :normal, {1005, "Client not responding to pings"}, state}

      last_msg_time ->
        if :timer.now_diff(:erlang.timestamp(), last_msg_time) > @ping_interval * 1000 do
          {:push, {:ping, ""}, schedule_ping(%{state | last_msg_time: :ping_sent})}
        else
          {:ok, schedule_ping(state)}
        end
    end
  end

  # While processing the SatInStartReplicationReq message, Protocol has determined that a new
  # client has connected which needs to perform the initial sync of migrations and the current database state before
  # subscribing to the replication stream.
  def handle_info({:perform_initial_sync_and_subscribe, msg}, %State{} = state) do
    # Fetch the latest observed LSN from the cached WAL. We have to do it before fetching migrations.
    #
    # If we were to do it the other way around, we could miss a migration that is committed right after the call to
    # migrations_since() but before the client subscribes to the replication stream. If the migration was immediately
    # followed by another write in PG, we could have fetched the LSN of this last write with get_current_position() and
    # thus miss the migration committed just before it.
    lsn = CachedWal.Api.get_current_position()

    _ = maybe_pause(lsn)

    %SatInStartReplicationReq{schema_version: schema_version} = msg
    migrations = InitialSync.migrations_since(schema_version, state.pg_connector_opts, lsn)

    {msgs, state} =
      migrations
      |> Enum.map(&{&1, &1.lsn})
      |> Protocol.handle_outgoing_txs(state)

    max_txid = migrations |> Enum.map(& &1.xid) |> Enum.max(fn -> 0 end)

    state =
      Protocol.subscribe_client_to_replication_stream(lsn, state)
      |> Map.update!(:out_rep, &%{&1 | last_migration_xid_at_initial_sync: max_txid})

    push({msgs, state})
  end

  def handle_info({:subscription_data, subscription_id, _}, %State{} = state)
      when not is_map_key(state.subscriptions, subscription_id) do
    Logger.debug(
      "Received initial data for unknown subscription #{subscription_id}, likely it has been cancelled"
    )

    {:ok, state}
  end

  def handle_info({:subscription_data, subscription_id, data}, %State{} = state)
      when is_out_rep_paused(state) and is_pending_subscription(state, subscription_id) do
    Logger.debug(
      "Received initial data for subscription #{subscription_id} while paused waiting for it"
    )

    push(send_subscription_data_and_unpause(subscription_id, data, state))
  end

  def handle_info({:subscription_data, subscription_id, data}, %State{} = state)
      when is_out_rep_paused(state) do
    Logger.debug(
      "Received initial data for subscription #{subscription_id} while paused waiting for a different subscription"
    )

    {:ok,
     %{state | out_rep: OutRep.store_subscription_data(state.out_rep, subscription_id, data)}}
  end

  def handle_info({:subscription_data, subscription_id, data}, %State{} = state) do
    Logger.debug("Saving the initial data until we reach insertion point")

    # Stream hasn't reached the tx yet (otherwise it would be paused), so we're going to save the data
    {:ok,
     %{state | out_rep: OutRep.store_subscription_data(state.out_rep, subscription_id, data)}}
  end

  def handle_info({:subscription_init_failed, subscription_id, reason}, state) do
    Logger.error(
      "Couldn't retrieve initial data for subscription #{subscription_id}, with reason #{inspect(reason)}"
    )

    error = %SatSubsDataError{
      subscription_id: subscription_id,
      message: "Could not retrieve initial data for subscription"
    }

    # In any case we need to remove the subscription itself so that it doesn't register as "not pending anymore"
    state
    |> Map.update!(:subscriptions, &Map.delete(&1, subscription_id))
    |> case do
      state when is_out_rep_paused(state) and is_pending_subscription(state, subscription_id) ->
        # We're paused on this, we want to send the error and unpause
        error
        |> send_subscription_data_error_and_unpause(state)
        |> push()

      state ->
        # We're either paused on smth else, or replication is stopped, or replication is ongoing
        # In any case, we just remove the "future" pause point and notify the client
        # We remove the pause point and notify the client

        {error, %{state | out_rep: OutRep.remove_pause_point(state.out_rep, subscription_id)}}
        |> push()
    end
  end

  if Mix.env() == :test do
    def handle_info({:pause_during_initial_sync, ref, client_pid}, state) do
      Process.put(:pause_during_initial_sync, {ref, client_pid})
      {:ok, state}
    end
  end

  def handle_info(msg, state) do
    # There might be a race between DOWN message from consumer and following
    # attempt to subscribe, so it's ok to receive down messages here on some
    # occasion
    Logger.warning("Unhandled msg ws connection: #{inspect(msg)}")
    {:ok, state}
  end

  # Handlers for GenStage messages coming from Producer and Consumer
  @spec handle_producer_msg(
          GenStage.from(),
          {:cancel, term()} | [term()],
          State.t()
        ) :: WebSock.handle_result()
  defp handle_producer_msg(_, {:cancel, reason}, %State{out_rep: out_rep} = state) do
    Logger.debug("log producer canceled subscription: #{inspect(reason)}")

    push({%SatErrorResp{}, %State{state | out_rep: %OutRep{out_rep | pid: nil, stage_sub: nil}}})
  end

  defp handle_producer_msg(from, _events, %State{out_rep: out_rep} = state)
       when from != {out_rep.pid, out_rep.stage_sub} do
    # We're not subscribed to this, let's drop it
    {:ok, state}
  end

  defp handle_producer_msg(from, events, %State{} = state)
       when is_out_rep_active(state) do
    GenStage.ask(from, 1)

    push(send_events_and_maybe_pause(events, state))
  end

  defp handle_producer_msg(from, events, %State{} = state)
       when is_out_rep_paused(state) do
    GenStage.ask(from, 1)
    {:ok, %{state | out_rep: OutRep.add_events_to_buffer(state.out_rep, events)}}
  end

  defp handle_producer_msg(_from, _events, state) do
    # Ignore messages, as subscription is not active
    {:ok, state}
  end

  @spec handle_consumer_msg(
          {pid(), reference()},
          {:ask, pos_integer()} | {:cancel, any} | {:subscribe, any, any},
          State.t()
        ) :: WebSock.handle_result()
  defp handle_consumer_msg(
         {pid, sub_tag},
         {:subscribe, _current, _options},
         %State{in_rep: in_rep} = state
       ) do
    # Subscription is either initial subscription, or restart of the consumer
    case in_rep.pid do
      nil -> Process.monitor(pid)
      ^pid -> :ok
      _pid -> Process.monitor(pid)
    end

    lsn = fetch_last_acked_client_lsn(state) || ""

    msgs =
      case in_rep.status do
        :requested -> []
        :active -> [%SatInStopReplicationReq{}, %SatInStartReplicationReq{lsn: lsn}]
        st when st in [nil, :paused] -> [%SatInStartReplicationReq{lsn: lsn}]
      end

    in_rep = %InRep{in_rep | stage_sub: sub_tag, pid: pid, status: :requested}
    push({msgs, %State{state | in_rep: in_rep}})
  end

  defp handle_consumer_msg(
         {pid, sub_tag},
         {:cancel, _reason},
         %State{in_rep: %InRep{pid: pid, stage_sub: sub_tag} = in_rep} = state
       ) do
    # status == :nil is not possible, as it is set to pause once we have consumer
    maybe_stop =
      case in_rep.status do
        :active -> [%SatInStopReplicationReq{}]
        :paused -> []
        :requested -> [%SatInStopReplicationReq{}]
      end

    in_rep = %InRep{state.in_rep | queue: :queue.new(), pid: nil, stage_sub: nil, status: :paused}
    push({maybe_stop, %State{state | in_rep: in_rep}})
  end

  defp handle_consumer_msg(
         {pid, sub_tag},
         {:ask, demand},
         %State{in_rep: %InRep{pid: pid, stage_sub: sub_tag} = in_rep} = state
       ) do
    case in_rep.status do
      :active ->
        {:ok, %State{state | in_rep: Protocol.send_downstream(state.in_rep)}}

      st when st in [:requested, :paused] ->
        {:ok, %State{state | in_rep: %InRep{in_rep | demand: demand + in_rep.demand}}}
    end
  end

  @typep deep_msg_list() :: PB.sq_pb_msg() | [deep_msg_list()]
  @typep pushable :: {deep_msg_list(), State.t()}

  @spec push(pushable()) :: WebSock.handle_result()
  defp push({pb_msg, %State{} = state}), do: {:push, binary_frames(pb_msg), state}

  @spec binary_frames(deep_msg_list()) :: [{:binary, iolist()}]
  defp binary_frames(pb_msg) when not is_list(pb_msg), do: [binary_frame(pb_msg)]
  defp binary_frames(msgs) when is_list(msgs), do: Utils.flatten_map(msgs, &binary_frame/1)

  defp binary_frame(pb_msg) do
    Logger.debug("Responding with: #{inspect(pb_msg)}")
    {:ok, iolist} = PB.encode_with_type(pb_msg)
    {:binary, iolist}
  end

  @spec schedule_ping(State.t()) :: State.t()
  defp schedule_ping(%State{} = state) do
    Process.send_after(self(), {:timeout, :ping_timer}, @ping_interval)
    state
  end

  @spec send_events_and_maybe_pause([PB.sq_pb_msg()], State.t()) :: pushable()
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

  @spec unpause_and_send_pending_events(deep_msg_list(), State.t()) :: pushable()
  defp unpause_and_send_pending_events(msgs, state) do
    buffer = state.out_rep.outgoing_ops_buffer

    state =
      state.out_rep
      |> OutRep.set_event_buffer([])
      |> OutRep.set_status(:active)
      |> then(&%{state | out_rep: &1})

    {next_msgs, state} =
      buffer
      |> :queue.to_list()
      |> send_events_and_maybe_pause(state)

    {[msgs, next_msgs], state}
  end

  @spec send_subscription_data_and_unpause(deep_msg_list(), String.t(), any(), State.t()) ::
          pushable()
  defp send_subscription_data_and_unpause(msgs \\ [], id, data, state) do
    state = Map.update!(state, :out_rep, &OutRep.remove_next_pause_point/1)

    {more_msgs, state} = Protocol.handle_subscription_data(id, data, state)

    unpause_and_send_pending_events([msgs, more_msgs], state)
  end

  @spec send_subscription_data_error_and_unpause(deep_msg_list(), State.t()) :: pushable()
  defp send_subscription_data_error_and_unpause(error, state) do
    unpause_and_send_pending_events(
      [error],
      Map.update!(state, :out_rep, &OutRep.remove_next_pause_point/1)
    )
  end

  if Mix.env() == :test do
    defp maybe_pause(lsn) do
      with {client_ref, client_pid} <- Process.get(:pause_during_initial_sync) do
        Logger.debug("WebsocketServer pausing")
        send(client_pid, {client_ref, :server_paused})

        {:ok, request_ref} = CachedWal.Api.request_notification(lsn)

        receive do
          {:cached_wal_notification, ^request_ref, :new_segments_available} ->
            Logger.debug("WebsocketServer unpaused")
            :ok
        after
          5_000 ->
            raise "Failed to observe the next lsn after #{inspect(lsn)}"
        end
      end
    end

    defp fetch_last_acked_client_lsn(_state), do: nil
  else
    defp maybe_pause(_), do: :ok

    def fetch_last_acked_client_lsn(state) do
      state.pg_connector_opts
      |> Electric.Replication.Connectors.get_connection_opts(replication: false)
      |> Electric.Replication.Postgres.Client.with_conn(fn conn ->
        Electric.Postgres.Extension.fetch_last_acked_client_lsn(conn, state.client_id)
      end)
    end
  end
end
