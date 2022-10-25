defmodule Electric.Test.SatelliteWsClient do
  @moduledoc """

  """
  require Logger
  alias Electric.Satellite.PB.Utils

  alias Electric.Satellite.{
    SatAuthReq,
    SatAuthResp,
    SatPingReq,
    SatPingResp,
    SatInStartReplicationReq,
    SatInStartReplicationResp,
    # SatInStopReplicationReq,
    # SatInStopReplicationResp,
    SatOpLog,
    SatOpBegin,
    SatOpInsert,
    SatOpUpdate,
    SatOpDelete,
    SatOpCommit,
    SatTransOp,
    SatRelationColumn
  }

  defmodule State do
    defstruct auto_in_sub: false,
              auto_ping: false,
              debug: false,
              filter_reply: nil,
              format: :term,
              history: nil,
              num: 0,
              parent: nil,
              stream_ref: nil,
              conn: nil,
              last_lsn: nil
  end

  def connect() do
    host = {127, 0, 0, 1}
    port = 5133
    connect(host, port)
  end

  def connect(host, port) do
    host =
      case host do
        h when is_binary(h) -> :erlang.binary_to_list(host)
        _ -> host
      end

    {:ok, conn} = :gun.open(host, port, %{:transport => :tcp})
    {:ok, _} = :gun.await_up(conn)
    stream_ref = :gun.ws_upgrade(conn, "/ws", [])

    {:upgrade, [<<"websocket">>], _} = :gun.await(conn, stream_ref)
    {:ok, {conn, stream_ref}}
  end

  # Automatically send auth
  @type opt() ::
          {:auth, boolean()}
          | {:host, String.t()}
          | {:port, pos_integer()}
          | {:debug, boolean()}
          # Logging format
          | {:format, :term | :json | :compact}
          # Automatically respond to pings
          | {:auto_ping, boolean()}
          # Automatically acknowledge subscription from Electric
          | {:auto_in_sub, boolean()}
          # Client identification
          | {:id, term()}
          # Automatically subscribe to Electric starting from lsn
          | {:sub, String.t()}

  @spec connect_and_spawn([opt()]) :: pid()
  def connect_and_spawn(opts \\ []) do
    self = self()
    :application.ensure_all_started(:gun)
    :proc_lib.start(__MODULE__, :loop_init, [self, opts])
  end

  def is_alive() do
    Process.alive?(:erlang.whereis(__MODULE__))
  end

  def send_test_relation() do
    relation = %Electric.Satellite.SatRelation{
      columns: [
        %SatRelationColumn{name: "id", type: "uuid"},
        %SatRelationColumn{name: "content", type: "varchar"},
        %SatRelationColumn{name: "content_b", type: "varchar"}
      ],
      relation_id: 11111,
      schema_name: "public",
      table_name: "entries",
      table_type: :TABLE
    }

    send_data(relation)
    :ok
  end

  def send_new_data(lsn, commit_time, id, value) do
    send_tx_data(
      lsn,
      commit_time,
      {:insert, %SatOpInsert{relation_id: 11111, row_data: [id, value, ""]}}
    )
  end

  def send_update_data(lsn, commit_time, id, value) do
    send_tx_data(
      lsn,
      commit_time,
      {:update, %SatOpUpdate{relation_id: 11111, old_row_data: [], row_data: [id, value, ""]}}
    )
  end

  def send_delete_data(lsn, commit_time, id, value) do
    send_tx_data(
      lsn,
      commit_time,
      {:delete, %SatOpDelete{relation_id: 11111, old_row_data: [id, value, ""]}}
    )
  end

  def send_tx_data(lsn, commit_time, op) do
    tx = %SatOpLog{
      ops: [
        %SatTransOp{
          op: {:begin, %SatOpBegin{commit_timestamp: commit_time, lsn: lsn, trans_id: ""}}
        },
        %SatTransOp{op: op},
        %SatTransOp{
          op: {:commit, %SatOpCommit{commit_timestamp: commit_time, lsn: lsn, trans_id: ""}}
        }
      ]
    }

    send_data(tx)
    :ok
  end

  @spec send_data(Electric.Satellite.PB.Utils.sq_pb_msg(), fun() | :default) :: term()
  def send_data(data, filter \\ :default) do
    filter =
      case filter do
        :default -> fn _, _ -> true end
        etc -> etc
      end

    send(__MODULE__, {:ctrl_stream, data, filter})
  end

  @spec send_bin_data(binary(), fun() | :default) :: term()
  def send_bin_data(data, filter \\ :default) do
    filter =
      case filter do
        :default -> fn _, _ -> true end
        etc -> etc
      end

    send(__MODULE__, {:ctrl_bin, data, filter})
  end

  def disconnect() do
    conn = :erlang.whereis(__MODULE__)

    with true <- :erlang.is_pid(conn) do
      ref = :erlang.monitor(:process, conn)
      send(conn, {:gun_error, :none, :none, :none})

      receive do
        {:DOWN, ^ref, :process, _, _} ->
          :ok
      after
        5000 ->
          :erlang.exit(conn, :kill)
      end
    else
      _ -> :ok
    end
  end

  def get_ets() do
    __MODULE__
  end

  @spec loop_init(pid(), [opt()]) :: any
  def loop_init(parent, opts) do
    host = Keyword.get(opts, :host, "localhost")
    port = Keyword.get(opts, :port, 5133)
    {:ok, {conn, stream_ref}} = connect(host, port)

    self = self()
    Process.register(self(), __MODULE__)
    t = :ets.new(__MODULE__, [:named_table, :ordered_set])

    try do
      :proc_lib.init_ack(parent, {:ok, self()})
      Logger.info("started #{inspect(self)}")

      maybe_auth(conn, stream_ref, opts)
      maybe_subscribe(conn, stream_ref, opts)

      loop(%State{
        conn: conn,
        stream_ref: stream_ref,
        parent: parent,
        history: t,
        num: 0,
        debug: Keyword.get(opts, :debug, false),
        format: Keyword.get(opts, :format, :term),
        auto_ping: Keyword.get(opts, :auto_ping, false),
        auto_in_sub: Keyword.get(opts, :auto_in_sub, false)
      })
    rescue
      e ->
        Logger.error(Exception.format(:error, e, __STACKTRACE__))
        reraise e, __STACKTRACE__
    end
  end

  def loop(%State{conn: conn, stream_ref: stream_ref, history: table, num: num} = state) do
    receive do
      {:ctrl_opts, opts} ->
        :gun.update_flow(conn, stream_ref, opts)
        loop(state)

      {:ctrl_stream, data, filter} ->
        {:ok, type, _iodata} = Utils.encode(data)
        :gun.ws_send(conn, stream_ref, {:binary, serialize(data)})

        maybe_debug("send data #{type}: #{inspect(data)}", state)
        loop(%State{state | filter_reply: filter})

      {:ctrl_bin, data, filter} ->
        :gun.ws_send(conn, stream_ref, {:binary, data})
        maybe_debug("send bin data: #{inspect(data)}", state)
        loop(%State{state | filter_reply: filter})

      {:gun_response, ^conn, _, _, status, headers} ->
        :gun.close(conn)
        Logger.error("gun error: #{inspect(status)} #{inspect(headers)}")

      {:gun_error, _, _, :none} ->
        :gun.close(conn)

      {:gun_error, _, _, reason} ->
        :gun.close(conn)
        Logger.error("gun error: #{inspect(reason)}")

      {:gun_ws, ^conn, ^stream_ref, :close} ->
        :gun.close(conn)
        Logger.info("gun_ws: close by the server")

      {:gun_ws, ^conn, ^stream_ref, {:binary, <<type::8, data::binary>> = bin}} ->
        maybe_debug("received bin: #{type} #{inspect(data)}", state)
        data = deserialize(bin, state.format)

        case data do
          %SatPingReq{} when state.auto_ping == true ->
            Process.send(
              self(),
              {:ctrl_stream, %SatPingResp{lsn: state.last_lsn}, state.filter_reply},
              []
            )

          %SatInStartReplicationReq{} when state.auto_in_sub == true ->
            Process.send(
              self(),
              {:ctrl_stream, %SatInStartReplicationResp{}, state.filter_reply},
              []
            )

          _ ->
            :ok
        end

        :ets.insert(table, {num, data})

        case state.filter_reply do
          nil ->
            :ok

          fun ->
            case fun.(num, data) do
              true ->
                msg = {__MODULE__, data}
                maybe_debug("sending to: #{inspect(state.parent)} #{inspect(msg)}", state)
                send(state.parent, msg)

              false ->
                :ok
            end
        end

        case data do
          %SatPingReq{} ->
            Logger.info("rec: #{inspect(data)}")
            loop(%State{state | num: num})

          _ ->
            Logger.info("rec [#{num}]: #{inspect(data)}")
            loop(%State{state | num: num + 1})
        end

      msg ->
        Logger.warn("Unhandled: #{inspect(msg)}")
    end
  end

  def maybe_auth(conn, stream_ref, opts) do
    case true == :lists.member(:auth, opts) or
           true == Keyword.get(opts, :auth, false) do
      true ->
        id = Keyword.get(opts, :id, "id")
        auth_req = serialize(%SatAuthReq{id: id, token: "token"})
        :gun.ws_send(conn, stream_ref, {:binary, auth_req})
        {:ws, {:binary, auth_frame}} = :gun.await(conn, stream_ref)
        %SatAuthResp{} = deserialize(auth_frame)
        :ok = :gun.update_flow(conn, stream_ref, 1)
        Logger.debug("Auth passed")

      false ->
        :ok
    end
  end

  def maybe_subscribe(conn, stream_ref, opts) do
    case Keyword.get(opts, :sub, nil) do
      nil ->
        :ok

      lsn ->
        sub_req = serialize(%SatInStartReplicationReq{lsn: lsn})
        :gun.ws_send(conn, stream_ref, {:binary, sub_req})
        # {:ws, {:binary, _sub_resp}} = :gun.await(conn, stream_ref)
        # %SatInStartReplicationResp{} = deserialize(sub_resp)
        # :ok = :gun.update_flow(conn, stream_ref, 1)
        Logger.debug("Subscribed")
    end
  end

  def maybe_debug(format, %{debug: true}) do
    Logger.debug(format)
  end

  def maybe_debug(_, _) do
    :ok
  end

  def serialize(data) do
    {:ok, type, iodata} = Utils.encode(data)
    [<<type::8>>, iodata]
  end

  def deserialize(binary, format \\ :term) do
    <<type::8, data::binary>> = binary

    case format do
      :compact ->
        {:ok, data} = Utils.decode(type, data)
        compact(data)

      :term ->
        {:ok, data} = Utils.decode(type, data)
        data

      :json when data !== <<"">> ->
        {:ok, data} = Utils.json_decode(type, data, [:return_maps, :use_nil])
        data

      _ ->
        {:ok, data} = Utils.decode(type, data)
        data
    end
  end

  def compact(%SatOpLog{ops: ops}) do
    Enum.reduce(
      ops,
      nil,
      fn
        %SatTransOp{op: {:begin, %SatOpBegin{commit_timestamp: tmp, lsn: lsn, trans_id: id}}},
        _acc ->
          %{commit_timestamp: tmp, lsn: :erlang.binary_to_term(lsn), trans_id: id}

        %SatTransOp{op: {:commit, _}}, acc ->
          acc

        %SatTransOp{op: {key, _}}, acc ->
          Map.update(acc, key, 0, fn n -> n + 1 end)
      end
    )
  end

  def compact(other) do
    other
  end
end
