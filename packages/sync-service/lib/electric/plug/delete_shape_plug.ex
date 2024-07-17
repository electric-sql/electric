defmodule Electric.Plug.DeleteShapePlug do
  require Logger
  use Plug.Builder

  alias Electric.Shapes
  alias Electric.Plug.ServeShapePlug.Params

  plug :fetch_query_params
  plug :put_resp_content_type, "application/json"

  plug :allow_shape_deletion
  plug :validate_query_params

  plug :truncate_or_delete_shape

  defp allow_shape_deletion(%Plug.Conn{} = conn, _) do
    if conn.assigns.config[:allow_shape_deletion] do
      conn
    else
      conn
      |> send_resp(404, Jason.encode_to_iodata!(%{status: "Not found"}))
      |> halt()
    end
  end

  defp validate_query_params(%Plug.Conn{} = conn, _) do
    all_params =
      Map.merge(conn.query_params, conn.path_params)
      |> Map.take(["root_table", "shape_id"])
      |> Map.put("offset", "-1")

    case Params.validate(all_params, inspector: conn.assigns.config[:inspector]) do
      {:ok, params} ->
        %{conn | assigns: Map.merge(conn.assigns, params)}

      {:error, error_map} ->
        conn
        |> send_resp(400, Jason.encode_to_iodata!(error_map))
        |> halt()
    end
  end

  defp truncate_or_delete_shape(%Plug.Conn{} = conn, _) do
    if conn.assigns.shape_id !== nil do
      with :ok <- Shapes.clean_shape(conn.assigns.shape_id, conn.assigns.config) do
        send_resp(conn, 204, "")
      end
    else
      # FIXME: This has a race condition where we accidentally create a snapshot & shape id, but clean
      #        it before snapshot is actually made.
      with {shape_id, _} <-
             Shapes.get_or_create_shape_id(conn.assigns.shape_definition, conn.assigns.config),
           :ok <- Shapes.clean_shape(shape_id, conn.assigns.config) do
        send_resp(conn, 204, "")
      end
    end
  end
end
