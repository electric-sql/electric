defmodule Electric.Plug.Migrations do
  use Plug.Router
  use Electric.Satellite.Protobuf

  alias Electric.Postgres.Extension.{SchemaCache, SchemaLoader}

  require Logger

  plug :match

  plug Plug.Parsers,
    parsers: [:json],
    pass: ["application/json"],
    json_decoder: Jason

  plug :dispatch

  get "/" do
    conn = fetch_query_params(conn)

    with {:ok, dialect} <- get_dialect(conn),
         {:ok, migrations} when migrations != [] <- get_migrations(conn),
         {:ok, body} <- migrations_zipfile(migrations, dialect) do
      conn
      |> put_resp_content_type("application/zip", nil)
      |> send_resp(200, body)
    else
      {:ok, []} ->
        send_resp(conn, 204, "")

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
    SchemaCache.Global.migration_history(version)
  end

  defp migrations_zipfile(migrations, dialect) do
    file_list =
      Enum.flat_map(migrations, fn %{version: version, schema: schema, stmts: stmts} ->
        ops = translate_stmts(version, schema, stmts, dialect)

        sql =
          ops
          |> Enum.flat_map(fn op -> Enum.map(op.stmts, & &1.sql) end)
          |> Enum.join("\n\n")

        metadata =
          ops
          |> Enum.map(&table_metadata_proto/1)
          |> then(
            &%{
              version: version,
              ops: &1,
              format: "SatOpMigrate",
              protocol_version: "Electric.Satellite"
            }
          )
          |> Jason.encode!()

        [
          {zip_filename(version, "migration.sql"), sql},
          {zip_filename(version, "metadata.json"), metadata}
        ]
      end)

    with {:ok, {_, zip}} <- :zip.create(~c"migrations.zip", file_list, [:memory]) do
      {:ok, zip}
    end
  end

  defp translate_stmts(version, schema, stmts, dialect) do
    Enum.flat_map(stmts, fn stmt ->
      schema_version = SchemaLoader.Version.new(version, schema)

      {:ok, msgs, _relations} =
        Electric.Postgres.Replication.migrate(schema_version, stmt, dialect)

      msgs
    end)
  end

  defp table_metadata_proto(table_proto) do
    table_proto
    |> SatOpMigrate.encode!()
    |> IO.iodata_to_binary()
    |> Base.encode64()
  end

  defp zip_filename(version, filename) do
    version
    |> Path.join(filename)
    |> to_charlist()
  end
end
