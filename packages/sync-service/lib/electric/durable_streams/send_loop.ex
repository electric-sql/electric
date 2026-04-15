defmodule Electric.DurableStreams.SendLoop do
  @moduledoc """
  GenServer that serializes HTTP/2 sends while pipelining responses.

  Vendored from durable-replication. Owns an HTTP client connection (via the
  HttpClient behaviour). Sends one request at a time (serialized writes to
  the TCP connection), but does NOT wait for responses before sending the
  next — responses arrive asynchronously on HTTP/2 streams.

  Supports `wait_for_ack/1` for backpressure: the caller blocks until the
  next batch response arrives.
  """

  use GenServer

  require Logger

  alias Electric.DurableStreams.HttpClient.Mint, as: MintClient

  defstruct [
    :callback_pid,
    :url,
    :auth_token,
    :http_client,
    :conn,
    send_queue: :queue.new(),
    pending_responses: %{},
    response_acc: %{},
    waiter: nil,
    reconnect_attempts: 0,
    http_client_opts: [],
    compress: false,
    send_blocked: false,
    pending_body: nil
  ]

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  def start_link(opts) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @doc """
  Enqueue a batch for serialized sending. Non-blocking cast.

  `path` overrides the default URL path for this request (e.g., to target
  a specific shape's durable stream at `<prefix>/<shape_handle>`).
  Pass `nil` to use the default path from the connection URL.
  """
  def enqueue(pid, slot_seq, encoded_body, commit_lsn, oldest_recv_at, n_changes \\ 0, n_txns \\ 0, path \\ nil) do
    GenServer.cast(
      pid,
      {:enqueue, slot_seq, encoded_body, commit_lsn, oldest_recv_at, n_changes, n_txns, path}
    )
  end

  @doc """
  Block until the next batch response arrives. Used for backpressure when
  the in-flight tracker is full. Returns `{slot_seq, :ok | {:error, reason}}`.
  """
  def wait_for_ack(pid) do
    GenServer.call(pid, :wait_for_ack, :infinity)
  end

  @doc "Replace send queue with given items for connection recovery."
  def clear_and_requeue(pid, items) do
    GenServer.cast(pid, {:clear_and_requeue, items})
  end

  # ---------------------------------------------------------------------------
  # GenServer callbacks
  # ---------------------------------------------------------------------------

  @impl true
  def init(opts) do
    url = Keyword.fetch!(opts, :url)
    auth_token = Keyword.fetch!(opts, :auth_token)
    http_client = Keyword.get(opts, :http_client, Electric.DurableStreams.HttpClient.Mint)
    http_client_opts = Keyword.get(opts, :http_client_opts, [])
    compress = Keyword.get(opts, :compress, false)
    callback_pid = Keyword.get(opts, :callback_pid)

    uri = URI.parse(url)

    state = %__MODULE__{
      callback_pid: callback_pid,
      url: uri,
      auth_token: auth_token,
      http_client: http_client,
      http_client_opts: http_client_opts,
      compress: compress
    }

    case http_client.connect(uri, http_client_opts) do
      {:ok, conn} ->
        needs_warmup = http_client == Electric.DurableStreams.HttpClient.Mint
        {:ok, %{state | conn: conn, send_blocked: needs_warmup}}

      {:error, reason} ->
        Logger.warning("Initial HTTP connection failed: #{inspect(reason)}, will retry")
        send(self(), :reconnect)
        {:ok, state}
    end
  end

  @impl true
  def handle_cast(
        {:enqueue, slot_seq, encoded_body, commit_lsn, oldest_recv_at, n_changes, n_txns, path},
        state
      ) do
    item = {slot_seq, encoded_body, commit_lsn, oldest_recv_at, n_changes, n_txns, path}
    state = %{state | send_queue: :queue.in(item, state.send_queue)}
    {:noreply, maybe_send_next(state)}
  end

  def handle_cast({:clear_and_requeue, items}, state) do
    queue =
      Enum.reduce(items, :queue.new(), fn {slot_seq, encoded_body, commit_lsn}, q ->
        :queue.in({slot_seq, encoded_body, commit_lsn, nil, 0, 0, nil}, q)
      end)

    state = %{state | send_queue: queue, pending_responses: %{}, response_acc: %{}}

    if is_nil(state.conn) do
      send(self(), :reconnect)
      {:noreply, state}
    else
      {:noreply, maybe_send_next(state)}
    end
  end

  @impl true
  def handle_call(:wait_for_ack, from, state) do
    {:noreply, %{state | waiter: from}}
  end

  @impl true
  def handle_info(:reconnect, state) do
    case state.http_client.connect(state.url, state.http_client_opts) do
      {:ok, conn} ->
        Logger.info("HTTP connection (re)established")
        needs_warmup = state.http_client == Electric.DurableStreams.HttpClient.Mint

        state = %{state | conn: conn, reconnect_attempts: 0, send_blocked: needs_warmup}

        if needs_warmup do
          {:noreply, state}
        else
          {:noreply, send_next(state)}
        end

      {:error, reason} ->
        attempts = state.reconnect_attempts + 1
        backoff = min(trunc(200 * :math.pow(2, attempts - 1)), 30_000)

        Logger.warning(
          "HTTP reconnect attempt #{attempts} failed: #{inspect(reason)}, retry in #{backoff}ms"
        )

        Process.send_after(self(), :reconnect, backoff)
        {:noreply, %{state | reconnect_attempts: attempts}}
    end
  end

  def handle_info(msg, state) when state.conn != nil do
    case state.http_client.stream(state.conn, msg) do
      {:ok, conn, responses} ->
        state = %{state | conn: conn}
        state = process_responses(state, responses)
        state = %{state | send_blocked: false}
        state = send_next(state)
        {:noreply, state}

      {:error, conn, reason, responses} ->
        state = %{state | conn: conn}
        state = process_responses(state, responses)
        Logger.warning("HTTP stream error: #{inspect(reason)}")
        {:noreply, handle_connection_lost(state)}

      :unknown ->
        {:noreply, state}
    end
  end

  def handle_info(_msg, state) do
    {:noreply, state}
  end

  # ---------------------------------------------------------------------------
  # Internal
  # ---------------------------------------------------------------------------

  defp maybe_send_next(%{send_blocked: true} = state), do: state
  defp maybe_send_next(state), do: send_next(state)

  defp send_next(%{conn: nil} = state), do: state

  defp send_next(state) do
    if state.pending_body != nil do
      resume_pending_body(state)
    else
      send_next_from_queue(state)
    end
  end

  defp resume_pending_body(state) do
    {ref, remaining, slot_seq, commit_lsn, http_start, oldest_recv_at, n_changes, n_txns,
     body_size, wire_size} = state.pending_body

    case MintClient.resume_body(state.conn, ref, remaining) do
      {:ok, conn} ->
        pending =
          Map.put(
            state.pending_responses,
            ref,
            {slot_seq, commit_lsn, http_start, oldest_recv_at, n_changes, n_txns, body_size,
             wire_size}
          )

        %{state | conn: conn, pending_body: nil, pending_responses: pending}

      {:partial, conn, ^ref, still_remaining} ->
        %{
          state
          | conn: conn,
            pending_body:
              {ref, still_remaining, slot_seq, commit_lsn, http_start, oldest_recv_at, n_changes,
               n_txns, body_size, wire_size},
            send_blocked: true
        }

      {:error, conn, reason} ->
        Logger.warning("Resume body failed: #{inspect(reason)}")
        %{state | conn: conn, pending_body: nil}
    end
  end

  defp send_next_from_queue(state) do
    case :queue.out(state.send_queue) do
      {:empty, _} ->
        state

      {{:value, {slot_seq, encoded_body, commit_lsn, oldest_recv_at, n_changes, n_txns, item_path}}, rest} ->
        path = item_path || state.url.path || "/"

        {wire_body, extra_headers} =
          if state.compress do
            {:zlib.gzip(encoded_body), [{"content-encoding", "gzip"}]}
          else
            {encoded_body, []}
          end

        headers = [
          {"authorization", "Bearer #{state.auth_token}"},
          {"content-type", "application/json"},
          {"stream-seq", to_string(commit_lsn)}
          | extra_headers
        ]

        http_start = System.monotonic_time(:microsecond)
        body_size = byte_size(encoded_body)
        wire_size = byte_size(wire_body)

        case state.http_client.request(state.conn, "POST", path, headers, wire_body) do
          {:ok, conn, ref} ->
            pending =
              Map.put(
                state.pending_responses,
                ref,
                {slot_seq, commit_lsn, http_start, oldest_recv_at, n_changes, n_txns, body_size,
                 wire_size}
              )

            state = %{state | conn: conn, send_queue: rest, pending_responses: pending}
            send_next_from_queue(state)

          {:partial, conn, ref, remaining} ->
            %{
              state
              | conn: conn,
                send_queue: rest,
                pending_body:
                  {ref, remaining, slot_seq, commit_lsn, http_start, oldest_recv_at, n_changes,
                   n_txns, body_size, wire_size},
                send_blocked: true
            }

          {:error, conn, reason} when reason == :window_exhausted ->
            item = {slot_seq, encoded_body, commit_lsn, oldest_recv_at, n_changes, n_txns, item_path}
            %{state | conn: conn, send_queue: :queue.in_r(item, rest), send_blocked: true}

          {:error, conn, %Mint.HTTPError{reason: reason}}
          when reason == :too_many_concurrent_requests or
                 (is_tuple(reason) and elem(reason, 0) == :exceeds_window_size) ->
            item = {slot_seq, encoded_body, commit_lsn, oldest_recv_at, n_changes, n_txns, item_path}
            %{state | conn: conn, send_queue: :queue.in_r(item, rest), send_blocked: true}

          {:error, conn, reason} ->
            Logger.warning("HTTP request failed: #{inspect(reason)}")
            state = %{state | conn: conn}
            handle_connection_lost(state)
        end
    end
  end

  defp process_responses(state, responses) do
    Enum.reduce(responses, state, fn
      {:status, ref, status}, state ->
        acc = Map.get(state.response_acc, ref, %{})

        %{
          state
          | response_acc: Map.put(state.response_acc, ref, Map.put(acc, :status, status))
        }

      {:headers, ref, headers}, state ->
        acc = Map.get(state.response_acc, ref, %{})
        existing = Map.get(acc, :headers, [])

        %{
          state
          | response_acc:
              Map.put(state.response_acc, ref, Map.put(acc, :headers, existing ++ headers))
        }

      {:data, ref, data}, state ->
        acc = Map.get(state.response_acc, ref, %{})
        existing = Map.get(acc, :data, "")

        %{
          state
          | response_acc:
              Map.put(state.response_acc, ref, Map.put(acc, :data, existing <> data))
        }

      {:done, ref}, state ->
        handle_request_done(state, ref)

      {:error, ref, reason}, state ->
        Logger.warning("HTTP request error for ref #{inspect(ref)}: #{inspect(reason)}")
        handle_request_error(state, ref, reason)
    end)
  end

  defp handle_request_done(state, ref) do
    {pending_info, pending} = Map.pop(state.pending_responses, ref)
    {resp_acc, response_acc} = Map.pop(state.response_acc, ref)
    state = %{state | pending_responses: pending, response_acc: response_acc}

    case pending_info do
      nil ->
        state

      {slot_seq, commit_lsn, _http_start, _oldest_recv_at, _n_changes, _n_txns, _body_size,
       _wire_size} ->
        status = (resp_acc && resp_acc[:status]) || 0
        headers = (resp_acc && resp_acc[:headers]) || []
        body = (resp_acc && resp_acc[:data]) || ""

        result =
          cond do
            status == 200 ->
              :ok

            status == 204 ->
              Logger.debug("Append accepted (204) for seq #{commit_lsn}")
              :ok

            status == 429 ->
              retry_after = get_header(headers, "retry-after")

              Logger.warning(
                "Rate limited (429), retry-after: #{retry_after || "unspecified"}"
              )

              {:error, {:rate_limited, retry_after}}

            status == 409 ->
              closed = get_header(headers, "stream-closed")

              if closed == "true" do
                Logger.error("Stream is closed (409), body: #{body}")
                {:error, :stream_closed}
              else
                Logger.warning("Conflict (409) for seq #{commit_lsn}, body: #{body}")
                {:error, {:conflict, body}}
              end

            status == 413 ->
              Logger.error("Payload too large (413)")
              {:error, :permanent}

            status in 400..499 ->
              Logger.error("HTTP error #{status}, body: #{body}")
              {:error, :permanent}

            true ->
              Logger.warning("HTTP error #{status}, body: #{body}")
              {:error, {:http_error, status}}
          end

        deliver_result(state, slot_seq, result)
    end
  end

  defp handle_request_error(state, ref, reason) do
    {pending_info, pending} = Map.pop(state.pending_responses, ref)
    response_acc = Map.delete(state.response_acc, ref)
    state = %{state | pending_responses: pending, response_acc: response_acc}

    case pending_info do
      nil -> state
      {slot_seq, _, _, _, _, _, _, _} -> deliver_result(state, slot_seq, {:error, reason})
    end
  end

  defp deliver_result(state, slot_seq, result) do
    case state.waiter do
      nil ->
        if state.callback_pid, do: send(state.callback_pid, {:batch_response, slot_seq, result})
        state

      from ->
        GenServer.reply(from, {slot_seq, result})
        %{state | waiter: nil}
    end
  end

  defp handle_connection_lost(state) do
    if state.callback_pid, do: send(state.callback_pid, :http_connection_lost)

    if state.conn do
      state.http_client.close(state.conn)
    end

    send(self(), :reconnect)
    %{state | conn: nil, pending_responses: %{}, response_acc: %{}}
  end

  defp get_header(headers, name) do
    case List.keyfind(headers, name, 0) do
      {_, value} -> value
      nil -> nil
    end
  end
end
