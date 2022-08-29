defmodule Electric.Test.SatelliteWsClient do
  @moduledoc """

  """
  require Logger
  alias Electric.Satellite.PB.Utils
  alias Electric.Satellite.{SatAuthReq, SatAuthResp}

  defmodule State do
    defstruct conn: nil,
              stream_ref: nil,
              num: 0,
              filter_reply: nil,
              parent: nil,
              history: nil
  end

  def connect() do
    host = {127, 0, 0, 1}
    port = 5133
    connect(host, port)
  end

  def connect(host, port) do
    {:ok, conn} = :gun.open(host, port, %{:transport => :tcp})
    # %{:transport => :tcp,
    #                                   :ws_opts => %{:flow => 1}
    #                                 })
    {:ok, _} = :gun.await_up(conn)
    stream_ref = :gun.ws_upgrade(conn, "/ws", [])

    {:upgrade, [<<"websocket">>], _} = :gun.await(conn, stream_ref)
    {:ok, {conn, stream_ref}}
  end

  @spec connect_and_spawn([{:auth, boolean()}, {:ignore_in_rep, boolean()}]) :: pid()
  def connect_and_spawn(opts \\ []) do
    self = self()
    :application.ensure_all_started(:gun)
    :proc_lib.start(__MODULE__, :loop_init, [self, opts])
  end

  def is_alive() do
    Process.alive?(:erlang.whereis(__MODULE__))
  end

  @spec send_data(Electric.Satellite.PB.Utils.sq_pb_msg(), fun()) :: term()
  def send_data(data, filter \\ :default) do
    filter =
      case filter do
        :default -> fn _, _ -> true end
        etc -> etc
      end

    send(__MODULE__, {:ctrl_stream, data, filter})
  end

  @spec send_bin_data(binary(), fun()) :: term()
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
        {:DOWN, ref, :process, _, _} ->
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

  def loop_init(parent, opts) do
    {:ok, {conn, stream_ref}} = connect()

    self = self()
    Process.register(self(), __MODULE__)
    t = :ets.new(__MODULE__, [:named_table, :ordered_set])

    try do
      :proc_lib.init_ack(parent, {:ok, self()})
      Logger.info("started #{inspect(self)}")

      case Keyword.get(opts, :auth, nil) do
        nil ->
          :ok

        true ->
          auth_req = serialize(%SatAuthReq{token: "token"})
          :gun.ws_send(conn, stream_ref, {:binary, auth_req})
          {:ws, {:binary, auth_frame}} = :gun.await(conn, stream_ref)
          %SatAuthResp{} = deserialize(auth_frame)
          :ok = :gun.update_flow(conn, stream_ref, 1)
      end

      loop(%State{conn: conn, stream_ref: stream_ref, parent: parent, history: t, num: 0})
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

        Logger.debug("send data #{type}: #{inspect(data)}")
        loop(%State{state | filter_reply: filter})

      {:ctrl_bin, data, filter} ->
        :gun.ws_send(conn, stream_ref, {:binary, data})
        Logger.debug("send bin data: #{inspect(data)}")
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

      {:gun_ws, ^conn, ^stream_ref, {:binary, <<type::8, data::binary>>}} ->
        Logger.info("received bin: #{type} #{inspect(data)}")
        {:ok, data} = Utils.decode(type, data)
        :ets.insert(table, {num, data})

        case state.filter_reply do
          nil ->
            :ok

          fun ->
            case fun.(num, data) do
              true ->
                msg = {__MODULE__, data}
                Logger.info("sending to: #{inspect(state.parent)} #{inspect(msg)} ")
                send(state.parent, msg)

              false ->
                :ok
            end
        end

        Logger.info("received dec: #{inspect(data)}")
        loop(%State{state | num: num + 1})

      msg ->
        Logger.warn("Unhandled: #{inspect(msg)}")
    end
  end

  def serialize(data) do
    {:ok, type, iodata} = Utils.encode(data)
    [<<type::8>>, iodata]
  end

  def deserialize(binary) do
    <<type::8, data::binary>> = binary
    {:ok, data} = Utils.decode(type, data)
    data
  end
end
