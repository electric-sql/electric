defmodule Electric.Client.Fetch.HTTP do
  @default_timeout 5 * 60
  @schema NimbleOptions.new!(
            timeout: [
              type: {:or, [:pos_integer, {:in, [:infinity]}]},
              doc: """
              Request timeout in seconds or `:infinity` for no timeout.

              The client will keep trying the remote Electric server until it reaches
              this timeout.
              """,
              default: @default_timeout,
              type_spec: quote(do: pos_integer() | :infinity)
            ],
            is_transient_fun: [
              type: {:fun, 1},
              default: &Electric.Client.Fetch.HTTP.transient_response?/1,
              doc: """
              Function that determines if a server response represents a transient error and should be retried.

              Defaults to identical behaviour to `Req`, and retries any
              response with an HTTP 408/429/500/502/503/504 status.
              """
            ],
            headers: [
              type: {:or, [{:map, :string, :string}, {:list, {:tuple, [:string, :string]}}]},
              doc: """
              Additional headers to add to every request.

              This can be a list of tuples, `[{"my-header", "my-header-value"}]` or a map.
              """,
              default: [],
              type_spec: quote(do: [{binary(), binary()}] | %{binary() => binary()})
            ],
            request: [
              type: :keyword_list,
              doc: """
              Options to include in `Req.new/1` for every request.
              """,
              default: []
            ]
          )

  @moduledoc """
  Client `Electric.Client.Fetch` implementation for HTTP requests to an
  external Electric API server.

  This is the default backend when creating an Electric client using
  `Electric.Client.new/1`.

  You can configure aspects of its behaviour by passing options when in the
  call to `Electric.Client.new/1`

      Electric.Client.new(
        base_url: "http://localhost:3000",
        fetch:
          {Electric.Client.Fetch.HTTP,
            timeout: 3600,
            request: [headers: [{"authorize", "Bearer xxxtoken"}]}
      )


  ## Options

  #{NimbleOptions.docs(@schema)}
  """

  alias Electric.Client.Fetch

  require Logger

  @behaviour Electric.Client.Fetch

  @impl Electric.Client.Fetch
  def validate_opts(opts) do
    NimbleOptions.validate(opts, @schema)
  end

  @impl Electric.Client.Fetch
  def fetch(%Fetch.Request{authenticated: true} = request, opts) do
    request
    |> build_request(opts)
    |> request()
  end

  @doc false
  def build_request(%Fetch.Request{authenticated: true} = request, opts) do
    request_opts = Keyword.get(opts, :request, [])
    {retry_delay, request_opts} = Keyword.pop(request_opts, :retry_delay, &retry_delay/1)

    retry_delay_fun =
      case retry_delay do
        fun1 when is_function(fun1, 1) -> fun1
        delay when is_integer(delay) and delay > 0 -> fn _ -> delay end
      end

    is_transient_fun =
      Keyword.get(opts, :is_transient_fun, &Electric.Client.Fetch.HTTP.transient_response?/1)

    connect_options = []
    timeout = Keyword.get(opts, :timeout, @default_timeout)

    [
      method: request.method,
      url: Fetch.Request.url(request),
      headers: merge_headers(request.headers, Keyword.get(opts, :headers, [])),
      retry: &retry(&1, &2, retry_delay_fun, is_transient_fun, timeout),
      # turn off req's retry logging and replace with ours
      retry_log_level: false,
      # :infinity actually means this number of retries, which equates to ~10 years
      max_retries: 10_512_000,
      # we use long polling with a timeout of 20s so we don't want Req to error before
      # Electric has returned something
      receive_timeout: 60_000,
      connect_options: Keyword.merge([protocols: [:http2, :http1]], connect_options)
    ]
    |> Req.new()
    |> merge_options(request_opts)
    |> Req.Request.put_private(:electric_start_request, now())
  end

  defp request(request) do
    now = DateTime.utc_now()
    request |> Req.request() |> wrap_resp(now)
  end

  defp wrap_resp({:ok, %Req.Response{} = resp}, timestamp) do
    %{status: status, headers: headers, body: body} = resp
    {:ok, Fetch.Response.decode!(status, headers, body, timestamp)}
  end

  defp wrap_resp({:error, _} = error, _timestamp) do
    error
  end

  defp merge_options(%Req.Request{} = request, options) do
    %{request | options: Map.merge(request.options, Map.new(options), &resolve_merge_options/3)}
  end

  defp resolve_merge_options(_key, left, right)
       when is_list(left) and (is_list(right) or is_map(right)) do
    Keyword.merge(left, Enum.to_list(right))
  end

  defp resolve_merge_options(_key, left, right)
       when is_map(left) and (is_list(right) or is_map(right)) do
    Map.merge(left, Map.new(right))
  end

  defp resolve_merge_options(_key, _left, right) do
    right
  end

  defp merge_headers(request_headers, opts_headers) do
    Enum.concat(Enum.to_list(request_headers), Enum.to_list(opts_headers))
  end

  defp retry(
         %Req.Request{} = request,
         response_or_error,
         retry_delay_fun,
         is_transient_fun,
         :infinity
       ) do
    if transient?(response_or_error, is_transient_fun) do
      delay_ms = request_delay(request, retry_delay_fun)
      log_retry(response_or_error, retry_count(request), delay_ms, "")

      {:delay, delay_ms}
    end
  end

  defp retry(
         %Req.Request{} = request,
         response_or_error,
         retry_delay_fun,
         is_transient_fun,
         max_age
       )
       when is_integer(max_age) do
    start_time = Req.Request.get_private(request, :electric_start_request)
    age = now() - start_time
    delay_ms = request_delay(request, retry_delay_fun)

    # using the :transient retry methodology here, retrying even POSTs,
    # because our server's endpoints are idempotent by design
    if transient?(response_or_error, is_transient_fun) && age + delay_ms / 1000 <= max_age do
      log_retry(
        response_or_error,
        retry_count(request),
        delay_ms,
        " #{max_age - age}s remaining."
      )

      {:delay, delay_ms}
    else
      false
    end
  end

  defp log_retry(response_or_error, retry_count, delay_ms, timeout_message) do
    Logger.warning(fn ->
      case response_or_error do
        %{__exception__: true} = exception ->
          [
            "retry: got exception: (",
            inspect(exception.__struct__),
            ") ",
            Exception.message(exception)
          ]

        response ->
          ["retry: got response with status #{response.status}, "]
      end
    end)

    Logger.warning(fn ->
      [
        "retry: transient error. attempt #{retry_count + 1}, will retry in #{delay_ms}ms.",
        timeout_message
      ]
    end)
  end

  defp retry_count(%Req.Request{} = request),
    do: Req.Request.get_private(request, :req_retry_count, 0)

  defp request_delay(%Req.Request{} = request, retry_delay_fun) do
    request
    |> retry_count()
    |> then(retry_delay_fun)
  end

  defp retry_delay(n) do
    (Integer.pow(2, n) * 1000 * jitter())
    |> min(30_000 * jitter())
    |> trunc()
  end

  defp jitter() do
    1 - 0.1 * :rand.uniform()
  end

  defp now, do: System.monotonic_time(:second)

  @transient_status [408, 429, 500, 502, 503, 504]

  @doc """
  List of HTTP status codes that represent a retryable error.
  """
  def transient_status_codes, do: @transient_status

  @doc """
  Test the given `Req.Response` against the list of transient error status
  codes.

  Returns `true` if the response has a status code in this list and so the
  request is retryable.
  """
  @spec transient_response?(Req.Response.t(), [pos_integer(), ...]) :: boolean()
  def transient_response?(response, status_codes \\ @transient_status)

  def transient_response?(%Req.Response{status: status}, status_codes) do
    status in status_codes
  end

  defp transient?(%Req.Response{} = response, is_transient_fun) do
    is_transient_fun.(response)
  end

  defp transient?(%Req.TransportError{reason: reason}, _is_transient_fun)
       when reason in [:timeout, :econnrefused, :closed] do
    true
  end

  defp transient?(%Req.HTTPError{protocol: :http2, reason: :unprocessed}, _is_transient_fun) do
    true
  end

  defp transient?(%{__exception__: true}, _is_transient_fun) do
    false
  end
end
