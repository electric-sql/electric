defmodule Electric.Plug.Migrations do
  use Plug.Router

  alias Electric.Postgres.Extension.SchemaCache

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
    conn = fetch_query_params(conn)

    with {:ok, dialect} <- get_dialect(conn),
         {:ok, migrations} <- get_migrations(conn),
         {:ok, body} <- migrations_zipfile(migrations, dialect) do
      conn
      |> put_resp_content_type("application/zip", nil)
      |> send_resp(200, body)
    else
      {:error, reason} ->
        json(conn, 403, %{error: to_string(reason)})
    end
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end

  defp json(conn, status, data) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(data))
  end

  defp get_dialect(%{query_params: %{"dialect" => dialect_name}}) do
    case dialect_name do
      "sqlite" -> {:ok, Electric.Postgres.Dialect.SQLite}
      _ -> {:error, "unsupported dialect #{inspect(dialect_name)}"}
    end
  end

  defp get_dialect(_conn) do
    {:error, "missing required parameter 'dialect'"}
  end

  defp get_migrations(%{query_params: %{"version" => empty}}) when empty in [nil, ""] do
    migrations_for_version(nil)
  end

  defp get_migrations(%{query_params: %{"version" => version}}) do
    migrations_for_version(version)
  end

  defp get_migrations(_conn) do
    migrations_for_version(nil)
  end

  defp migrations_for_version(version) do
    SchemaCache.migration_history(version)
  end

  defp migrations_zipfile(migrations, dialect) do
    file_list =
      Enum.map(migrations, fn {version, stmts} ->
        sql =
          stmts
          |> Enum.map(&Electric.Postgres.Dialect.to_sql(&1, dialect))
          |> Enum.join("\n\n")

        filename =
          version
          |> Path.join("migration.sql")
          |> to_charlist()

        {filename, sql}
      end)

    with {:ok, {_, zip}} <- :zip.create('migrations.zip', file_list, [:memory]) do
      {:ok, zip}
    end
  end
end
