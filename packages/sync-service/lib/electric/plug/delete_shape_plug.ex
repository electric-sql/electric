defmodule Electric.Plug.DeleteShapePlug do
  use Plug.Builder, copy_opts_to_assign: :config

  alias Electric.Shapes.Api

  plug :fetch_query_params
  plug :put_resp_content_type, "application/json"

  plug :validate_request
  plug :truncate_or_delete_shape

  defp validate_request(%Plug.Conn{assigns: %{config: config}} = conn, _) do
    api = Access.fetch!(config, :api)

    # No filtering here: `Api.Params` casting drops unknown parameters and
    # `validate_for_delete/2` ignores request-only ones such as `offset` and
    # `live`, so the shape definition is built from the same parameters a GET
    # request would use.
    all_params = Map.merge(conn.query_params, conn.path_params)

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

    Api.delete_shape(conn, request)
  end
end
