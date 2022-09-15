defmodule Electric.Test.SatelliteMockClient do
  @moduledoc """
  Mock to facilitate Satellite testing
  """

  require Logger
  alias Electric.Satellite.PB.Utils
  alias Electric.Satellite.{SatAuthReq, SatAuthResp}

  defmodule State do
    defstruct socket: nil,
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
    :gen_tcp.connect(host, port, [{:active, true}, {:nodelay, true}, :binary, {:packet, 4}])
  end

  @spec connect_and_spawn([{:auth, boolean()}, {:ignore_in_rep, boolean()}]) :: pid()
  def connect_and_spawn(opts \\ []) do
    self = self()
    :proc_lib.start(__MODULE__, :loop_init, [self, opts])
  end

  def is_alive() do
    Process.alive?(:erlang.whereis(__MODULE__))
  end

  def disconnect() do
    conn = :erlang.whereis(__MODULE__)

    with true <- :erlang.is_pid(conn) do
      ref = :erlang.monitor(:process, conn)
      send(conn, {:tcp_closed, :none})

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

  def set_opts(opts), do: send(__MODULE__, {:ctr_socket, opts})

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

  def loop_init(parent, opts) do
    {:ok, socket} = connect()

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
          :inet.setopts(socket, [{:active, false}])
          :ok = :gen_tcp.send(socket, serialize(%SatAuthReq{token: "token"}))
          {:ok, authresp} = :gen_tcp.recv(socket, 0)
          %SatAuthResp{} = deserialize(authresp)
          :inet.setopts(socket, [{:active, true}])
      end

      loop(%State{socket: socket, parent: parent, history: t, num: 0})
    rescue
      e ->
        Logger.error(Exception.format(:error, e, __STACKTRACE__))
        reraise e, __STACKTRACE__
    end
  end

  def loop(%State{socket: socket, history: table, num: num} = state) do
    receive do
      {:inet_reply, _, :ok} ->
        loop(state)

      {:ctrl_opts, opts} ->
        :inet.setopts(socket, opts)
        loop(state)

      {:ctrl_stream, data, filter} ->
        {:ok, type, _iodata} = Utils.encode(data)
        true = :erlang.port_command(socket, serialize(data))

        Logger.debug("send data #{type}: #{inspect(data)}")
        loop(%State{state | filter_reply: filter})

      {:ctrl_bin, data, filter} ->
        true = :erlang.port_command(socket, data)
        Logger.debug("send bin data: #{inspect(data)}")
        loop(%State{state | filter_reply: filter})

      {:tcp_passive, _} ->
        Logger.debug("tcp set to passive")

      {:tcp_error, _, reason} ->
        :gen_tcp.close(socket)
        Logger.error("tcp error #{inspect(reason)}")

      {:tcp_closed, sock} ->
        try do
          :gen_tcp.close(sock)
          Logger.error("tcp closed")
        rescue
          _ -> :ok
        end

      {:tcp, _, <<type::8, data::binary>>} ->
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
