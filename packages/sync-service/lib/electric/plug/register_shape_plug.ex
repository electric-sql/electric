defmodule Electric.Plug.RegisterShapePlug do
  @moduledoc """
  Registers (creates or resolves) a shape and returns its metadata as JSON.

  Used by the durable-streams shim in Electric Cloud: when a client makes an
  initial `/v1/shape` request with no handle, the shim translates it into a
  call to this endpoint to get the shape handle, schema, and the offset the
  underlying durable stream starts at. Subsequent reads are then served from
  the durable stream directly without routing through Electric.

  Unlike `ServeShapePlug`, this endpoint returns a small JSON document rather
  than the shape log itself.
  """
  use Plug.Builder, copy_opts_to_assign: :config
  use Plug.ErrorHandler

  import Plug.Conn

  alias Electric.Shapes.Api
  alias Plug.Conn

  require Logger

  plug :put_resp_content_type, "application/json"
  plug :fetch_query_params
  plug :parse_body
  plug :validate_request
  plug :load_shape
  plug :register_durable_stream
  plug :send_register_response

  defp parse_body(%Conn{method: "POST"} = conn, _) do
    case Conn.read_body(conn) do
      {:ok, "", conn} ->
        assign(conn, :body_params, %{})

      {:ok, body, conn} ->
        case Jason.decode(body) do
          {:ok, body_params} when is_map(body_params) ->
            assign(conn, :body_params, body_params)

          {:ok, _} ->
            conn
            |> send_resp(400, Jason.encode!(%{error: "Request body must be a JSON object"}))
            |> halt()

          {:error, %Jason.DecodeError{} = error} ->
            conn
            |> send_resp(
              400,
              Jason.encode!(%{
                error: "Invalid JSON in request body",
                details: Exception.message(error)
              })
            )
            |> halt()
        end

      {:more, _, conn} ->
        conn
        |> send_resp(413, Jason.encode!(%{error: "Request body too large"}))
        |> halt()

      {:error, _reason} ->
        conn
        |> send_resp(400, Jason.encode!(%{error: "Failed to read request body"}))
        |> halt()
    end
  end

  defp parse_body(conn, _), do: assign(conn, :body_params, %{})

  # Force a "new shape" lookup: no handle, initial offset. The register endpoint
  # never takes a handle — it always creates-or-resolves from the shape definition.
  @forced_params %{"offset" => "-1", "live" => "false"}

  defp validate_request(%Conn{assigns: %{config: config, body_params: body_params}} = conn, _) do
    api = Access.fetch!(config, :api)

    all_params =
      conn.query_params
      |> Map.merge(body_params)
      |> Map.merge(@forced_params)

    case Api.validate_params(api, all_params) do
      {:ok, request} ->
        assign(conn, :request, request)

      {:error, response} ->
        conn
        |> Api.Response.send(response)
        |> halt()
    end
  end

  defp load_shape(%Conn{assigns: %{request: request}} = conn, _) do
    case Api.load_shape_info(request) do
      {:ok, request} ->
        assign(conn, :request, request)

      {:error, response} ->
        conn
        |> Api.Response.send(response)
        |> halt()
    end
  end

  defp register_durable_stream(%Conn{assigns: %{request: request}} = conn, _) do
    stack_id = request.api.stack_id

    url = Electric.StackConfig.lookup!(stack_id, :durable_streams_url)
    token = Electric.StackConfig.lookup!(stack_id, :durable_streams_token)

    case Electric.DurableStreams.StreamManager.create_stream(request.handle,
           durable_streams_url: url,
           durable_streams_token: token
         ) do
      {:ok, next_offset} ->
        assign(conn, :stream_next_offset, next_offset)

      {:error, reason} ->
        conn
        |> send_resp(
          502,
          Jason.encode!(%{
            error: "Failed to create durable stream",
            reason: inspect(reason)
          })
        )
        |> halt()
    end
  end

  defp send_register_response(%Conn{assigns: %{request: request}} = conn, _) do
    stack_id = request.api.stack_id

    body = %{
      handle: request.handle,
      offset: to_string(request.last_offset),
      schema: Api.schema(request.response),
      stream_service_id: Electric.StackConfig.lookup!(stack_id, :durable_streams_service_id),
      stream_path: request.handle,
      content_type: "application/json",
      stream_next_offset_at_registration: conn.assigns.stream_next_offset
    }

    send_resp(conn, 200, Jason.encode!(body))
  end

  @impl Plug.ErrorHandler
  def handle_errors(conn, %{kind: kind, reason: reason, stack: _}) do
    error_str = Exception.format(kind, reason)
    send_resp(conn, conn.status || 500, Jason.encode!(%{error: error_str}))
  end
end
