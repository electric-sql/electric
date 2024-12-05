defmodule Electric.Client.Fetch.Mint.Connection do
  use GenServer

  alias Electric.Client.Fetch

  require Logger

  @default_timeout 60_000

  def name(stream_id) do
    {:via, Registry, {Electric.Client.Registry, {__MODULE__, stream_id}}}
  end

  def start_link(stream_id) do
    GenServer.start_link(__MODULE__, stream_id, name: name(stream_id))
  end

  def fetch(conn, request, opts) do
    GenServer.call(conn, {:request, request, opts}, :infinity)
  end

  @impl GenServer
  def init(stream_id) do
    Logger.debug(fn ->
      "Starting client connection #{stream_id}"
    end)

    {:ok,
     %{
       stream_id: stream_id,
       from: nil,
       conn: nil,
       ref: nil,
       resp: nil,
       timeout: nil,
       req: nil,
       tries: 0
     }}
  end

  @impl GenServer
  def handle_call({:request, request, opts}, from, state) do
    state = request({request, opts}, state)

    {:noreply, %{state | from: from, req: {request, opts}}}
  end

  @impl GenServer
  def handle_info({:ssl, _socket, _data} = msg, state) do
    stream_data(msg, state)
  end

  def handle_info({:ssl_closed, _socket}, state) do
    Logger.debug("[#{state.stream_id}] SSL closed")
    {:noreply, state |> maybe_close() |> maybe_retry()}
  end

  def handle_info({:ssl_error, _socket, reason}, state) do
    Logger.error("[#{state.stream_id}] SSL error: #{inspect(reason)}")
    {:noreply, state |> maybe_close() |> maybe_retry()}
  end

  def handle_info({:tcp, _socket, _data} = msg, state) do
    stream_data(msg, state)
  end

  def handle_info({:tcp_closed, _socket}, state) do
    Logger.debug("[#{state.stream_id}] TCP closed")
    {:noreply, state |> maybe_close() |> maybe_retry()}
  end

  def handle_info({:timeout, _ref, timeout}, state) do
    Logger.warning("[#{state.stream_id}] TIMEOUT #{timeout}ms")

    {:noreply,
     %{state | timeout: nil} |> maybe_close() |> sleep_before_reconnect() |> maybe_retry()}
  end

  defp stream_data(msg, %{conn: conn} = state) do
    case Mint.HTTP.stream(conn, msg) do
      {:ok, conn, responses} ->
        handle_responses(responses, %{state | conn: conn})

      {:error, conn, error, responses} ->
        Logger.warning("[#{state.stream_id}] Error: #{inspect(error)}")
        handle_responses(responses, %{state | conn: conn})

      :unknown ->
        Logger.warning("[#{state.stream_id}] Unrecognised data packet")
        {:noreply, state}
    end
  end

  defp request({request, opts}, state) do
    uri = Fetch.Request.uri(request, opts)

    state
    |> connect(uri, opts)
    |> make_request(request, uri, opts)
  end

  defp connect(%{conn: nil} = state, uri, opts) do
    Logger.debug("[#{state.stream_id}] Opening #{uri.scheme}://#{uri.host}:#{uri.port}")

    case Mint.HTTP.connect(String.to_atom(uri.scheme), uri.host, uri.port, transport_opts: []) do
      {:ok, conn} ->
        %{state | conn: conn, tries: 0}

      {:error, reason} ->
        tries = state.tries + 1

        sleep = retry_delay(tries)

        Logger.info(
          "[#{state.stream_id}] Failed to connect: #{uri.scheme}://#{uri.host}:#{uri.port}; #{inspect(reason)}"
        )

        Logger.info("[#{state.stream_id}] connect tries: #{tries}; sleeping: #{sleep}")

        Process.sleep(sleep)

        connect(%{state | tries: tries}, uri, opts)
    end
  end

  defp connect(state, _request, _opts) do
    state
  end

  @max_tries 30

  defp make_request(%{tries: @max_tries} = state, request, uri, opts) do
    %{state | tries: 0}
    |> maybe_close()
    |> sleep_before_reconnect()
    |> connect(uri, opts)
    |> make_request(request, uri, opts)
  end

  defp make_request(%{conn: conn} = state, request, uri, opts) do
    now = DateTime.utc_now()

    Mint.HTTP.request(
      conn,
      method(request.method),
      uri.path <> "?" <> uri.query,
      Enum.to_list(request.headers),
      nil
    )
    |> case do
      {:ok, conn, request_ref} ->
        timeout = Keyword.get(opts, :timeout, @default_timeout)
        ref = Process.send_after(self(), {:timeout, request_ref, timeout}, timeout)

        %{
          state
          | timeout: ref,
            conn: conn,
            ref: request_ref,
            tries: 0,
            resp: %Fetch.Response{request_timestamp: now}
        }

      {:error, conn, %Mint.HTTPError{reason: :closed}} ->
        Logger.info("[#{state.stream_id}] connection closed")

        %{state | conn: conn, tries: 0}
        |> maybe_close()
        |> sleep_before_reconnect()
        |> connect(uri, opts)
        |> make_request(request, uri, opts)

      {:error, conn, error} ->
        Logger.info(
          "[#{state.stream_id}] request error #{uri.path}?#{uri.query}: #{inspect(error)}"
        )

        tries = state.tries + 1
        sleep = retry_delay(tries)
        Logger.info("[#{state.stream_id}] request tries: #{tries}; sleeping: #{sleep}")
        Process.sleep(sleep)

        make_request(%{state | conn: conn, tries: tries}, request, uri, opts)
    end
  end

  defp method(:get), do: "GET"
  defp method(:post), do: "POST"
  defp method(:delete), do: "DELETE"

  defp handle_responses(responses, %{from: from} = state) do
    case Enum.reduce(responses, {:cont, state.resp}, &handle_response/2) do
      {:cont, resp} ->
        {:noreply, %{state | resp: resp}}

      {:done, resp} ->
        GenServer.reply(from, resp)
        {:noreply, reset(state)}
    end
  end

  defp handle_response({:status, _ref, status}, {:cont, resp}) do
    {:cont, %{resp | status: status}}
  end

  defp handle_response({:headers, _ref, headers}, {:cont, resp}) do
    {:cont, %{resp | headers: Enum.reduce(headers, resp.headers, &add_header/2)}}
  end

  defp handle_response({:data, _ref, data}, {:cont, resp}) do
    {:cont, %{resp | body: [resp.body | data]}}
  end

  defp handle_response({:done, _ref}, {:cont, resp}) do
    case IO.iodata_to_binary(resp.body) do
      "" ->
        {:done, Fetch.Response.decode!(%{resp | body: []})}

      json ->
        case Jason.decode(json) do
          {:ok, body} ->
            {:done, Fetch.Response.decode!(%{resp | body: body})}

          {:error, %Jason.DecodeError{} = error} ->
            Logger.error(["Received invalid JSON response: \n", error.data])
            {:done, {:error, error}}
        end
    end
  end

  defp add_header({key, value}, headers) do
    Map.update(headers, key, [value], &[value | &1])
  end

  defp maybe_retry(%{from: nil} = state) do
    cancel_timer(state)
  end

  defp maybe_retry(%{from: _from, req: {request, opts}} = state) do
    Logger.debug(fn ->
      "Retrying request #{inspect(request)}"
    end)

    request({request, opts}, cancel_timer(%{state | ref: nil, resp: nil}))
  end

  defp cancel_timer(%{timeout: timeout} = state) when is_reference(timeout) do
    Process.cancel_timer(timeout)
    %{state | timeout: nil}
  end

  defp cancel_timer(state) do
    state
  end

  defp reset(state) do
    cancel_timer(%{state | resp: nil, ref: nil, from: nil, req: nil})
  end

  defp maybe_close(%{conn: conn} = state) do
    if conn && Mint.HTTP.open?(conn) do
      Mint.HTTP.close(conn)
      %{state | conn: nil}
    else
      state
    end
  end

  defp sleep_before_reconnect(state) do
    1..30
    |> Enum.random()
    |> retry_delay()
    |> tap(&Logger.info("Sleeping #{&1}ms before reconnecting"))
    |> Process.sleep()

    state
  end

  defp retry_delay(n) do
    (Integer.pow(2, n) * 1000 * jitter())
    |> min(30_000 * jitter())
    |> trunc()
  end

  defp jitter() do
    1 - 0.5 * :rand.uniform()
  end
end
