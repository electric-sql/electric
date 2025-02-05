defmodule Electric.Plug.DeleteShapePlug do
  use Plug.Builder, copy_opts_to_assign: :config

  alias Electric.Shapes.Api

  require Logger

  plug :fetch_query_params
  plug :put_resp_content_type, "application/json"

  plug :validate_request
  plug :truncate_or_delete_shape

  defp validate_request(%Plug.Conn{assigns: %{config: config}} = conn, _) do
    api = Access.fetch!(config, :api)

    all_params =
      Map.merge(conn.query_params, conn.path_params)
      |> Map.take(["table", "handle"])
      |> Map.put("offset", "-1")

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
      response = Api.delete_shape(request)

      Api.Response.send(conn, response)
    else
      send_resp(conn, 404, Jason.encode!(%{message: "Shape not found"}))
    end
  end
end
