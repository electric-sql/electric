defmodule Electric.Plug.Status do
  use Plug.Router

  alias Electric.Replication.PostgresConnector
  alias Electric.Replication.PostgresConnectorMng

  plug :match
  plug :dispatch

  get "/" do
    fetch_origin()
    |> check_postgres_manager_status()
    |> send_response(conn)
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end

  defp fetch_origin do
    case PostgresConnector.connectors() do
      [origin] -> {:ok, origin}
      [] -> {:error, "PostgresConnector not running"}
    end
  end

  defp check_postgres_manager_status({:ok, origin}) do
    {:ok, PostgresConnectorMng.status(origin)}
  end

  defp check_postgres_manager_status(other), do: other

  defp send_response({:ok, :ready}, conn),
    do: send_resp(conn, 200, "Connection to Postgres is up!")

  defp send_response({:ok, _status}, conn),
    do: send_resp(conn, 503, "Initializing connection to Posgres...")

  defp send_response({:error, _}, conn), do: send_resp(conn, 503, "Database connection failure.")
end
