defmodule CloudElectric.Plugs.LoadTenantToAssignPlug do
  alias CloudElectric.TenantManager
  @behaviour Plug
  import Plug.Conn

  @impl Plug
  def init(assign_as: assign_key) when is_atom(assign_key), do: assign_key

  @impl Plug
  def call(%Plug.Conn{} = conn, assign_key) do
    conn = fetch_query_params(conn)

    with {:ok, id} <- Map.fetch(conn.query_params, "database_id"),
         {:ok, config} <- TenantManager.get_tenant(id, []) do
      conn
      |> put_resp_header("electric-database-id", id)
      |> assign(assign_key, config)
    else
      :error ->
        conn
        |> send_resp(
          400,
          Jason.encode_to_iodata!(%{"database_id" => ["query parameter missing"]})
        )
        |> halt()

      {:error, :not_found} ->
        conn
        |> send_resp(404, Jason.encode_to_iodata!(%{"database_id" => ["database not found"]}))
        |> halt()
    end
  end
end
