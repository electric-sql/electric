defmodule Electric.Plug.DeleteShapePlug do
  use Plug.Builder, copy_opts_to_assign: :config

  alias Electric.Shapes.Api

  plug :fetch_query_params
  plug :put_resp_content_type, "application/json"

  plug :validate_request
  plug :truncate_or_delete_shape

  # Deletion by shape definition needs every parameter that
  # `Electric.Shapes.Api.Params.define_shape/2` reads, otherwise the shape we
  # look the handle up with is not the shape the client created. Keeping this
  # list narrow (rather than passing the query params through wholesale) means
  # request-only parameters such as `offset` and `live`, which
  # `validate_for_delete/2` deliberately does not validate, stay out.

  defp validate_request(%Plug.Conn{assigns: %{config: config}} = conn, _) do
    api = Access.fetch!(config, :api)

    all_params =
      Map.merge(conn.query_params, conn.path_params)
      |> Map.take(["table", "handle", "where", "params", "columns", "queryable_columns", "replica", "log", "experimental_compaction"])
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

    Api.delete_shape(conn, request)
  end
end
