defmodule Electric.Plug.DeleteShapePlug do
  use Plug.Builder, copy_opts_to_assign: :config

  alias Electric.Shapes
  alias Electric.Shapes.Api

  require Logger

  plug :fetch_query_params
  plug :put_resp_content_type, "application/json"

  plug :allow_shape_deletion
  plug :validate_request
  plug :truncate_or_delete_shape

  defp allow_shape_deletion(%Plug.Conn{} = conn, _) do
    if get_in(conn.assigns.config[:api].allow_shape_deletion) do
      conn
    else
      conn
      |> send_resp(404, Jason.encode_to_iodata!(%{status: "Not found"}))
      |> halt()
    end
  end

  defp validate_request(%Plug.Conn{assigns: %{config: config}} = conn, _) do
    api = Access.fetch!(config, :api)

    all_params =
      Map.merge(conn.query_params, conn.path_params)
      |> Map.take(["table", "handle"])
      |> Map.put("offset", "-1")

    # validate but don't seek - we don't need the latest shape offset information
    case Api.validate_for_delete(api, all_params) do
      {:ok, request} ->
        assign(conn, :request, request)

      {:error, response} ->
        conn
        |> Api.Response.send(response)
        |> halt()
    end
  end

  defp truncate_or_delete_shape(%Plug.Conn{} = conn, _) do
    %{assigns: %{request: request}} = conn

    if !is_nil(request.handle) do
      :ok = Shapes.clean_shape(request.handle, request.api)
      send_resp(conn, 202, "")
    else
      send_resp(conn, 404, Jason.encode!(%{message: "Shape not found"}))
    end
  end
end
