defmodule Electric.Shapes.Api.Response do
  alias Electric.Plug.Utils
  alias Electric.Shapes.Api
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  defstruct [
    :handle,
    :offset,
    :shape_definition,
    api: %Api{},
    chunked: false,
    up_to_date: false,
    params: %Api.Params{},
    status: 200,
    trace_attrs: %{},
    body: []
  ]

  @type shape_handle :: Electric.ShapeCacheBehaviour.shape_handle()

  @type t() :: %__MODULE__{
          api: Api.t(),
          handle: nil | shape_handle(),
          offset: nil | Electric.Replication.LogOffset.t(),
          shape_definition: nil | Shape.t(),
          chunked: boolean(),
          params: Api.Params.t(),
          up_to_date: boolean(),
          status: pos_integer(),
          trace_attrs: %{optional(atom()) => term()},
          body: Enum.t()
        }

  @shape_definition_mismatch %{
    message:
      "The specified shape definition and handle do not match. " <>
        "Please ensure the shape definition is correct or omit " <>
        "the shape handle from the request to obtain a new one."
  }
  @before_all_offset Electric.Replication.LogOffset.before_all()

  def shape_definition_mismatch(request) do
    error(request, @shape_definition_mismatch)
  end

  def error(api_or_request, message, args \\ [])

  @spec error(Api.t() | Api.Request.t(), term(), keyword()) :: t()
  def error(%Api{} = api, message, args) do
    opts =
      args
      |> Keyword.put_new(:status, 400)
      |> Keyword.put(:body, error_body(api, message, args))
      |> Keyword.put(:api, api)

    struct(__MODULE__, opts)
  end

  def error(%Api.Request{} = request, message, args) do
    opts =
      args
      |> Keyword.put_new(:status, 400)
      |> Keyword.put(:body, error_body(request, message, args))
      |> Keyword.put(:shape_definition, request.params.shape_definition)
      |> Keyword.put(:api, request.api)

    struct(__MODULE__, opts)
  end

  def invalid_request(api_or_request, args) do
    error(api_or_request, "Invalid request", args)
  end

  defp error_body(api_or_request, message, args) when is_binary(message) do
    error_body(api_or_request, %{message: message}, args)
  end

  defp error_body(api_or_request, message, args) do
    body =
      if errors = Keyword.get(args, :errors) do
        Map.put(message, :errors, errors)
      else
        message
      end

    Api.encode_message(api_or_request, body)
  end

  @spec send(Plug.Conn.t(), t()) :: Plug.Conn.t()
  def send(%Plug.Conn{} = conn, %__MODULE__{chunked: false} = response) do
    conn
    |> put_resp_headers(response)
    |> Plug.Conn.send_resp(response.status, Enum.into(response.body, []))
  end

  def send(%Plug.Conn{} = conn, %__MODULE__{} = response) do
    conn
    |> put_resp_headers(response)
    |> send_stream(response)
  end

  defp put_resp_headers(conn, response) do
    conn
    |> put_cache_headers(response)
    |> put_cursor_headers(response)
    |> put_etag_headers(response)
    |> put_location_header(response)
    |> put_shape_handle_header(response)
    |> put_schema_header(response)
    |> put_up_to_date_header(response)
    |> put_offset_header(response)
    |> put_sse_headers(response)
  end

  defp put_location_header(conn, %__MODULE__{status: 409} = response) do
    params =
      conn.query_params
      |> Map.put("handle", response.handle)
      |> Map.put("offset", to_string(@before_all_offset))
      |> Map.delete("live")
      |> Map.delete("cursor")

    query = URI.encode_query(params)

    Plug.Conn.put_resp_header(
      conn,
      "location",
      "#{conn.request_path}?#{query}"
    )
  end

  defp put_location_header(conn, _response) do
    conn
  end

  defp put_shape_handle_header(conn, %__MODULE__{handle: nil}) do
    conn
  end

  defp put_shape_handle_header(conn, %__MODULE__{} = response) do
    Plug.Conn.put_resp_header(conn, "electric-handle", response.handle)
  end

  defp put_schema_header(conn, %__MODULE__{params: %{live: false}} = response) do
    Plug.Conn.put_resp_header(
      conn,
      "electric-schema",
      response |> Api.schema() |> Jason.encode!()
    )
  end

  defp put_schema_header(conn, _response) do
    conn
  end

  # Do not cache responses for any methods other then GET and OPTIONS
  defp put_cache_headers(%Plug.Conn{method: method} = conn, %__MODULE__{api: api})
       when method not in ["GET", "OPTIONS"] do
    conn
    |> put_cache_header("cache-control", "no-cache", api)
  end

  # Briefly cache 409s as they act as shape redirects, when the requested shape
  # is either invalidated or does not match the requested definition, and thus
  # can benefit from persisting this cache for a brief period of time to avoid
  # surges of traffic hitting the server whenever a shape is invalidated
  defp put_cache_headers(conn, %__MODULE__{status: status, api: api})
       when status in [409] do
    conn
    |> put_cache_header("cache-control", "public, max-age=60, must-revalidate", api)
  end

  # All other 4xx and 5xx responses should never be cached
  defp put_cache_headers(conn, %__MODULE__{status: status, api: api})
       when status >= 400 do
    conn
    |> put_cache_header("cache-control", "no-cache", api)
  end

  defp put_cache_headers(conn, %__MODULE__{api: api} = response) do
    header_value =
      case response do
        # If the offset is -1, set a 1 week max-age, 1 hour s-maxage (shared cache)
        # and 1 month stale-while-revalidate We want private caches to cache the
        # initial offset for a long time but for shared caches to frequently
        # revalidate so they're serving a fairly fresh copy of the initials shape
        # log.
        %{params: %{offset: @before_all_offset}} ->
          "public, max-age=604800, s-maxage=3600, stale-while-revalidate=2629746"

        # For live SSE requests we want to cache for just under the
        # sse_timeout, in order to enable request collapsing.
        %{params: %{live: true, experimental_live_sse: true}} ->
          "public, max-age=#{max(1, div(api.sse_timeout, 1000) - 1)}"

        # For normal live requests we want short cache lifetimes.
        %{params: %{live: true}} ->
          "public, max-age=5, stale-while-revalidate=5"

        # Non-live requests have the default cache headers.
        %{params: %{live: false}} ->
          "public, max-age=#{api.max_age}, stale-while-revalidate=#{api.stale_age}"
      end

    conn
    |> put_cache_header("cache-control", header_value, api)
  end

  defp put_cache_header(conn, header, value, %{send_cache_headers?: true}) do
    Plug.Conn.put_resp_header(conn, header, value)
  end

  defp put_cache_header(conn, _header, _value, %{send_cache_headers?: false}) do
    conn
  end

  defp put_cursor_headers(conn, %__MODULE__{} = response) do
    case response do
      # For live requests we want short cache lifetimes and to update the live cursor
      %{params: %{live: true}, api: api} ->
        conn
        |> Plug.Conn.put_resp_header(
          "electric-cursor",
          api.long_poll_timeout
          |> Utils.get_next_interval_timestamp(conn.query_params["cursor"])
          |> Integer.to_string()
        )

      _response ->
        conn
    end
  end

  defp put_etag_headers(conn, %{handle: nil}) do
    conn
  end

  defp put_etag_headers(conn, %__MODULE__{} = response) do
    # etag values should be in double quotes: https://www.rfc-editor.org/rfc/rfc7232#section-2.3
    Plug.Conn.put_resp_header(conn, "etag", etag(response))
  end

  defp put_up_to_date_header(conn, %__MODULE__{up_to_date: true}) do
    Plug.Conn.put_resp_header(conn, "electric-up-to-date", "")
  end

  defp put_up_to_date_header(conn, %__MODULE__{up_to_date: false}) do
    Plug.Conn.delete_resp_header(conn, "electric-up-to-date")
  end

  defp put_offset_header(conn, %__MODULE__{offset: nil}) do
    conn
  end

  defp put_offset_header(conn, %__MODULE__{offset: offset}) do
    Plug.Conn.put_resp_header(conn, "electric-offset", "#{offset}")
  end

  defp put_sse_headers(conn, %__MODULE__{params: %{live: true, experimental_live_sse: true}}) do
    conn
    |> Plug.Conn.put_resp_header("content-type", "text/event-stream")
    |> Plug.Conn.put_resp_header("connection", "keep-alive")
  end

  defp put_sse_headers(conn, _response) do
    conn
  end

  defp send_stream(%Plug.Conn{} = conn, %__MODULE__{body: stream, status: status} = response) do
    stack_id = Api.stack_id(response)
    conn = Plug.Conn.send_chunked(conn, status)

    {conn, bytes_sent} =
      Enum.reduce_while(stream, {conn, 0}, fn chunk, {conn, bytes_sent} ->
        chunk_size = IO.iodata_length(chunk)

        OpenTelemetry.with_span(
          "shape_get.plug.stream_chunk",
          [chunk_size: chunk_size],
          stack_id,
          fn ->
            case Plug.Conn.chunk(conn, chunk) do
              {:ok, conn} ->
                {:cont, {conn, bytes_sent + chunk_size}}

              {:error, "closed"} ->
                error_str = "Connection closed unexpectedly while streaming response"
                conn = Plug.Conn.assign(conn, :error_str, error_str)
                {:halt, {conn, bytes_sent}}

              {:error, reason} ->
                error_str = "Error while streaming response: #{inspect(reason)}"
                Logger.error(error_str)
                conn = Plug.Conn.assign(conn, :error_str, error_str)
                {:halt, {conn, bytes_sent}}
            end
          end
        )
      end)

    Plug.Conn.assign(conn, :streaming_bytes_sent, bytes_sent)
  end

  def etag(%__MODULE__{handle: handle, offset: offset, params: params} = _response, opts \\ []) do
    etag = "#{handle}:#{params.offset}:#{offset}"

    if Keyword.get(opts, :quote, true) do
      ~s|"#{etag}"|
    else
      etag
    end
  end
end
