defmodule Electric.Plug.MetadataSnapshotPlug do
  @moduledoc """
  Plug to create a snapshot of the source's metadata for debugging purposes.

  Returns a JSON object containing:
  - `xmin`: Oldest visible transaction ID
  - `xmax`: Next transaction ID to be assigned
  - `xip_list`: List of in-progress transaction IDs at the time of the snapshot
  - `database_lsn`: Current WAL log sequence number (as string)
  """

  use Plug.Builder

  alias Plug.Conn
  alias Electric.Connection.Manager
  alias Electric.Postgres.Lsn

  plug :fetch_query_params
  plug :get_snapshot_metadata
  plug :put_resp_content_type, "application/json"
  plug :put_cache_headers
  plug :send_response

  defp get_snapshot_metadata(%Conn{assigns: %{config: config}} = conn, _) do
    stack_id = config[:stack_id]
    pool = Manager.snapshot_pool(stack_id)

    result =
      Postgrex.transaction(
        pool,
        fn pg_conn ->
          Postgrex.query!(
            pg_conn,
            "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
            []
          )

          Postgrex.query!(pg_conn, "SELECT pg_current_snapshot(), pg_current_wal_lsn()", [])
        end,
        timeout: 30_000
      )

    case result do
      {:ok, %Postgrex.Result{rows: [[{xmin, xmax, xip_list}, lsn]]}} ->
        metadata = %{
          xmin: xmin,
          xmax: xmax,
          xip_list: xip_list,
          database_lsn: to_string(Lsn.to_integer(lsn))
        }

        conn
        |> assign(:metadata, metadata)
        |> assign(:status_code, 200)

      {:error, error} ->
        conn
        |> assign(:error, %{message: "Failed to get metadata snapshot: #{inspect(error)}"})
        |> assign(:status_code, 500)
    end
  catch
    :exit, {_, {DBConnection.Holder, :checkout, _}} ->
      conn
      |> assign(:error, %{message: "Database connection not available"})
      |> assign(:status_code, 503)
  end

  defp put_cache_headers(conn, _) do
    put_resp_header(conn, "cache-control", "no-cache, no-store, must-revalidate")
  end

  defp send_response(%Conn{assigns: %{metadata: metadata, status_code: status_code}} = conn, _) do
    send_resp(conn, status_code, Jason.encode!(metadata))
  end

  defp send_response(%Conn{assigns: %{error: error, status_code: status_code}} = conn, _) do
    send_resp(conn, status_code, Jason.encode!(error))
  end
end
