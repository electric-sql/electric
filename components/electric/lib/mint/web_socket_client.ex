defmodule Mint.WebSocketClient do
  @moduledoc """
  A GenServer wrapper over a Mint.WebSocket connection.

  `c:Genserver.init/1` callback tries to establish an HTTP connection
  and then upgrade it to websocket.

  Any GenServer callbacks will have a state as a 2-tuple: a conn struct
  to be used with functions from this module, and user-provided state.

  Any callbacks from this module (`c:handle_frame/2`, `c:do_handle_info/2`) get only
  user-provided state as the second argument.

  `c:GenServer.handle_info/2` callback cannot be used due to how Mint is set up, so all messages
  are forwarded to a `c:do_handle_info` callback instead.
  """

  alias Mint.WebSocketClient
  require Logger

  @type conn :: %{
          conn: Mint.HTTP.t(),
          websocket: Mint.WebSocket.t(),
          ref: reference(),
          subprotocol: String.t() | nil
        }

  @type handler_return ::
          {:noreply, term()}
          | {:reply, [{:text, String.t()} | {:binary, binary()}], term()}
          | {:stop, term(), term(), term()}
          | {:stop, term(), term(), [{:text, String.t()} | {:binary, binary()}], term()}

  @callback handle_connection(subprotocol :: String.t(), conn(), init_arg :: term()) ::
              {:ok, term(), [Mint.WebSocket.frame()]} | {:error, term()}
  @callback handle_frame({:text, String.t()} | {:binary, binary()}, term()) :: handler_return()

  @callback do_handle_info(term(), term()) :: handler_return()

  defmacro __using__(_opts) do
    quote do
      use GenServer, restart: :temporary
      require Logger

      alias Mint.WebSocketClient

      @behaviour Mint.WebSocketClient

      @impl GenServer
      def init(init_arg) do
        protocol = Keyword.get(init_arg, :protocol, :ws)
        host = Keyword.fetch!(init_arg, :host)
        port = Keyword.get(init_arg, :port, if(protocol == :wss, do: 443, else: 80))
        path = Keyword.get(init_arg, :path, "/")
        subprotocol = Keyword.get(init_arg, :subprotocol)

        ws_headers =
          [] ++ if(subprotocol, do: [{"sec-websocket-protocol", subprotocol}], else: [])

        with {:ok, state} <-
               Mint.WebSocketClient.setup_ws_connection(
                 protocol,
                 host,
                 port,
                 path,
                 ws_headers
               ) do
          case handle_connection(state.subprotocol, state, Keyword.get(init_arg, :init_arg)) do
            {:ok, user_state, extra_frames} ->
              state = {Map.merge(state, %{status: :open}), user_state}

              Enum.reduce_while(extra_frames, {:ok, state}, fn frame,
                                                               {:ok, {conn_state, user_state}} ->
                frame
                |> do_handle_frame(user_state)
                |> Mint.WebSocketClient.process_callback_response(conn_state)
                |> case do
                  {:noreply, state} -> {:cont, {:ok, state}}
                  {:stop, reason, _} -> {:halt, {:stop, reason}}
                end
              end)

            {:error, reason} ->
              Mint.HTTP.close(state.conn)
              {:stop, {:error, reason}}
          end
        else
          {:error, reason} ->
            Logger.error("HTTP connection to the server failed: #{inspect(reason)}")
            {:stop, {:error, reason}}

          {:error, conn, reason} ->
            Logger.error("Failed to upgrade websocket connection: #{inspect(reason)}")

            Mint.HTTP.close(conn)
            {:stop, {:error, reason}}
        end
      end

      @impl GenServer
      def handle_info(message, {%{conn: conn, ref: ref} = conn_state, user_state} = state) do
        case Mint.WebSocket.stream(conn, message) do
          :unknown ->
            do_handle_info(message, user_state)
            |> WebSocketClient.process_callback_response(conn_state)
            |> WebSocketClient.maybe_close_socket()

          {:ok, conn, [{:data, ^ref, data}]} ->
            decode_and_handle(data, WebSocketClient.update_state(state, %{conn: conn}))

          {:error, conn, error, response} ->
            Mint.HTTP.close(conn)
            {:stop, {:error, error, response}, state}
        end
      end

      @spec do_handle_frame(Mint.WebSocket.frame(), {WebSocketClient.conn(), term()}) ::
              WebSocketClient.handler_return()
      defp do_handle_frame({:ping, text}, state), do: {:reply, {:pong, text}, state}
      defp do_handle_frame({:pong, _}, state), do: {:noreply, state}

      defp do_handle_frame({:close, 1000, _}, state) do
        Logger.info("Server closed the websocket connection")

        {:stop, :normal, :close, state}
      end

      defp do_handle_frame({:close, code, reason}, state) do
        Logger.warning(
          "Server closed the websocket connection with code #{code} and reason #{reason}"
        )

        {:stop, :normal, :close, state}
      end

      defp do_handle_frame(frame, state) do
        handle_frame(frame, state)
      end

      @spec decode_and_handle(binary(), {WebSocketClient.conn(), term()}) ::
              {:noreply, term()} | {:stop, term(), term()}
      defp decode_and_handle(data, {conn_state, _} = state) do
        case Mint.WebSocket.decode(conn_state.websocket, data) do
          {:ok, websocket, frames} ->
            result_tuple = {:noreply, WebSocketClient.update_state(state, websocket: websocket)}

            Enum.reduce_while(frames, result_tuple, fn frame, {:noreply, {conn, user_state}} ->
              result =
                do_handle_frame(frame, user_state)
                |> WebSocketClient.process_callback_response(conn)
                |> WebSocketClient.maybe_close_socket()

              if elem(result, 0) == :stop do
                {:halt, result}
              else
                {:cont, result}
              end
            end)

          {:error, _websocket, error} ->
            Logger.debug("Invalid frame received: #{inspect(error)}")
            Mint.HTTP.close(conn_state.conn)
            {:stop, {:error, error}, state}
        end
      end

      def handle_connection(_, _, state), do: {:ok, state, []}
      def handle_frame(_, state), do: {:noreply, state}

      def do_handle_info(msg, state) do
        proc =
          case Process.info(self(), :registered_name) do
            {_, []} -> self()
            {_, name} -> name
          end

        Logger.warning(
          "#{inspect(__MODULE__)} #{inspect(proc)} received unexpected message in do_handle_info/2: #{inspect(msg)}"
        )

        {:noreply, state}
      end

      defoverridable Mint.WebSocketClient
    end
  end

  @doc """
  Send websocket frames over an established connection
  """
  @spec send_frames(conn(), [Mint.WebSocket.frame()]) :: {:ok, conn()} | {:error, any()}
  def send_frames(conn_state, frames) do
    with {:ok, websocket, data} <- encode_all(conn_state.websocket, frames),
         {:ok, conn} <-
           Mint.WebSocket.stream_request_body(conn_state.conn, conn_state.ref, data) do
      {:ok, %{conn_state | websocket: websocket, conn: conn}}
    else
      {:error, _, error} ->
        {:error, error}
    end
  end

  @doc """
  Try to receive next frames over an established connection
  """
  @spec receive_next_frames!(conn()) :: {:ok, conn(), [Mint.WebSocket.frame()]}
  def receive_next_frames!(%{conn: conn, websocket: websocket, ref: ref} = conn_state) do
    msg = receive do: ({proto, _, _} = message when proto in [:tcp, :ssl] -> message)
    {:ok, conn, [{:data, ^ref, data}]} = Mint.WebSocket.stream(conn, msg)
    {:ok, websocket, frames} = Mint.WebSocket.decode(websocket, data)

    {:ok, %{conn_state | websocket: websocket, conn: conn}, frames}
  end

  # Internal functions used by the functions created in the `__using__` macro
  @doc false
  @spec process_callback_response(handler_return(), conn()) ::
          {:noreply, {conn(), term()}} | {:stop, term(), {conn(), term()}}
  def process_callback_response({:noreply, user_state}, conn), do: {:noreply, {conn, user_state}}

  def process_callback_response({:reply, frames, user_state}, conn) do
    case send_frames(conn, List.wrap(frames)) do
      {:ok, conn} -> {:noreply, {conn, user_state}}
      {:error, reason} -> {:stop, {:error, reason}, {conn, user_state}}
    end
  end

  def process_callback_response({:stop, reason, close_reason, user_state}, conn)
      when close_reason == :close
      when is_tuple(close_reason) and tuple_size(close_reason) == 3 and
             elem(close_reason, 0) == :close do
    case send_frames(conn, List.wrap(close_reason)) do
      {:ok, conn} -> {:stop, reason, {conn, user_state}}
      {:error, %Mint.TransportError{reason: :closed}} -> {:stop, :normal, {conn, user_state}}
      {:error, reason} -> {:stop, {:error, reason}, {conn, user_state}}
    end
  end

  def process_callback_response({:stop, reason, close_reason, frames, user_state}, conn)
      when close_reason == :close
      when is_tuple(close_reason) and tuple_size(close_reason) == 3 and
             elem(close_reason, 0) == :close do
    case send_frames(conn, List.wrap(frames) ++ List.wrap(close_reason)) do
      {:ok, conn} -> {:stop, reason, {conn, user_state}}
      {:error, %Mint.TransportError{reason: :closed}} -> {:stop, :normal, {conn, user_state}}
      {:error, reason} -> {:stop, {:error, reason}, {conn, user_state}}
    end
  end

  @doc false
  def maybe_close_socket({:stop, reason, {%{conn: conn}, _} = state}) do
    {:ok, conn} = Mint.HTTP.close(conn)
    {:stop, reason, update_state(state, %{conn: conn})}
  end

  def maybe_close_socket({:noreply, state}), do: {:noreply, state}

  @spec encode_all(Mint.WebSocket.t(), [Mint.WebSocket.frame()]) ::
          {:ok, Mint.WebSocket.t(), iolist()} | {:error, Mint.WebSocket.t(), any()}
  defp encode_all(websocket, frames) do
    Enum.reduce_while(List.wrap(frames), {:ok, websocket, []}, fn frame, {:ok, ws, acc} ->
      case Mint.WebSocket.encode(ws, frame) do
        {:ok, ws, data} -> {:cont, {:ok, ws, [data | acc]}}
        {:error, ws, error} -> {:halt, {:error, ws, error}}
      end
    end)
    |> case do
      {:ok, ws, data} -> {:ok, ws, Enum.reverse(data)}
      {:error, _, _} = error -> error
    end
  end

  @doc false
  @spec update_state({conn(), term()}, map() | keyword()) :: {conn(), term()}
  def update_state({internal, user}, updates) do
    {Enum.into(updates, internal), user}
  end

  @doc false
  @spec setup_ws_connection(
          :ws | :wss,
          Mint.Types.address(),
          :inet.port_number(),
          String.t(),
          Mint.Types.headers()
        ) :: {:ok, conn()} | {:error, term()} | {:error, Mint.HTTP.t(), term()}
  def setup_ws_connection(protocol, host, port, path \\ "/", ws_headers \\ [])
      when protocol in [:ws, :wss] do
    http_protocol = if protocol == :ws, do: :http, else: :https

    Logger.debug(
      "Trying to establish websocket connection to #{protocol}://#{host}:#{port}#{path}"
    )

    with {:ok, conn} <- Mint.HTTP.connect(http_protocol, host, port, log: true),
         {:ok, conn, ref} <- Mint.WebSocket.upgrade(protocol, conn, path, ws_headers),
         http_reply_message = receive(do: (message -> message)),
         {:ok, conn, [{:status, ^ref, status}, {:headers, ^ref, resp_headers}, {:done, ^ref}]} <-
           Mint.WebSocket.stream(conn, http_reply_message),
         {:ok, subprotocol} <- validate_subprotocol(conn, ws_headers, resp_headers),
         {:ok, conn, websocket} <-
           Mint.WebSocket.new(conn, ref, status, resp_headers) do
      {:ok, %{conn: conn, websocket: websocket, ref: ref, subprotocol: subprotocol}}
    end
  end

  defp validate_subprotocol(conn, ws_headers, resp_headers) do
    protocols = {
      get_header(ws_headers, "sec-websocket-protocol"),
      get_header(resp_headers, "sec-websocket-protocol")
    }

    case protocols do
      # Subprotocol wasn't requested
      {nil, nil} ->
        {:ok, nil}

      # Subprotocol wasn't requested, but was sent by the server
      {nil, got} ->
        Logger.error("No subprotocol was requested, but the server returned #{inspect(got)}")
        {:error, conn, :invalid_subprotocol}

      # Subprotocol was requested, but the server ignored it
      {requested, nil} ->
        Logger.error("Subprotocols #{requested} were requested, but the server didn't send one")
        {:error, conn, :invalid_subprotocol}

      {requested, got} ->
        requested =
          String.split(requested, ",", trim: true)
          |> Enum.map(&String.trim/1)

        if got in requested do
          {:ok, got}
        else
          Logger.error(
            "Subprotocols #{requested} were requested, but the server returned #{inspect(got)}"
          )

          {:error, conn, :invalid_subprotocol}
        end
    end
  end

  defp get_header(headers, key) do
    Enum.find_value(headers, fn
      {^key, value} -> value
      _ -> nil
    end)
  end
end
