defmodule Electric.Shapes.Api.Response do
  alias Electric.Shapes.Api
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  defstruct [
    :handle,
    :offset,
    :shape_definition,
    chunked: false,
    up_to_date: false,
    status: 200,
    trace_attrs: %{},
    body: []
  ]

  @type shape_handle :: Electric.ShapeCacheBehaviour.shape_handle()

  @type t() :: %__MODULE__{
          handle: nil | shape_handle(),
          offset: nil | Electric.Replication.LogOffset.t(),
          shape_definition: nil | Shape.t(),
          chunked: boolean(),
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

  def shape_definition_mismatch(request) do
    error(request, @shape_definition_mismatch)
  end

  def error(api_or_request, message, args \\ [])

  @spec error(Api.t(), term(), keyword()) :: t()
  def error(%Api{} = api, message, args) do
    opts =
      args
      |> Keyword.put_new(:status, 400)
      |> Keyword.put(:body, Api.encode_message(api, message))

    struct(__MODULE__, opts)
  end

  def error(%Api.Request{} = request, message, args) do
    opts =
      args
      |> Keyword.put_new(:status, 400)
      |> Keyword.put(:body, Api.encode_message(request, message))
      |> Keyword.put(:shape_definition, get_in(request.params.shape_definition))

    struct(__MODULE__, opts)
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
    |> put_location_header(response)
    |> put_shape_handle_header(response)
    |> put_up_to_date_header(response)
    |> put_offset_header(response)
  end

  defp put_location_header(conn, %__MODULE__{status: 409} = response) do
    params = [
      table: Electric.Utils.relation_to_sql(response.shape_definition.root_table),
      handle: response.handle,
      offset: "-1"
    ]

    query = URI.encode_query(params)

    Plug.Conn.put_resp_header(
      conn,
      "location",
      "#{conn.request_path}?#{query}"
    )
  end

  defp put_location_header(conn, %__MODULE__{} = _response) do
    conn
  end

  defp put_shape_handle_header(conn, %__MODULE__{handle: nil}) do
    conn
  end

  defp put_shape_handle_header(conn, response) do
    Plug.Conn.put_resp_header(conn, "electric-handle", response.handle)
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

  defp send_stream(%Plug.Conn{} = conn, %__MODULE__{body: stream, status: status}) do
    stack_id = Api.stack_id(conn.assigns.request)
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
end
