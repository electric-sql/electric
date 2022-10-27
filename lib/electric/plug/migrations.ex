defmodule Electric.Plug.Migrations do
  alias Electric.Postgres.SchemaRegistry
  alias Electric.Replication.PostgresConnector
  alias Electric.Replication.PostgresConnectorMng

  use Plug.Router
  import Plug.Conn
  require Logger

  plug(:match)

  plug(Plug.Parsers,
    parsers: [:json],
    pass: ["application/json"],
    json_decoder: Jason
  )

  plug(:dispatch)

  get "/" do
    data = migration_info()
    send_resp(conn, 200, Jason.encode!(data))
  end

  get "/:origin" do
    origin = get_origin(conn)
    data = migration_info(origin)
    send_resp(conn, 200, Jason.encode!(data))
  end

  put "/:origin" do
    with origin <- get_origin(conn),
         conn <- fetch_query_params(conn),
         vsn <- conn.body_params["vsn"],
         true <- valid_vsn?(vsn) do
      case PostgresConnectorMng.migrate(origin, vsn) do
        :ok ->
          send_resp(conn, 200, "ok")

        {:error, error} ->
          send_resp(conn, 403, Kernel.inspect(error))
      end
    else
      _error ->
        send_resp(conn, 400, "Bad request")
    end
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end

  defp get_origin(conn) do
    conn.params["origin"]
  end

  defp valid_vsn?(vsn) do
    String.match?(vsn, ~r/^[\w\_]+$/)
  end

  def migration_info() do
    origins = PostgresConnector.connectors()
    Enum.map(origins, fn origin -> migration_info(origin) end)
  end

  defp migration_info(origin) do
    case SchemaRegistry.fetch_table_migration(origin) do
      nil -> "unknown"
      [h | _] -> Map.put(h, :origin, origin)
    end
  end
end
