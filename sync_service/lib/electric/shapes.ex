defmodule Electric.Shapes do
  alias Electric.Utils
  require Logger

  def query_snapshot(conn, table) do
    query = Postgrex.query!(conn, "SELECT * FROM #{table}", [])
    Logger.debug("Querying a snapshot for #{inspect(table)}")

    query.rows
    |> Enum.map(fn row ->
      Enum.zip_with(query.columns, row, fn
        "id", val -> {"id", Utils.encode_uuid(val)}
        col, val -> {col, val}
      end)
      |> Map.new()
    end)
  end

  def get_or_create_shape(table, opts \\ []) do
    shape_cache = Keyword.get(opts, :shape_cache, Electric.InMemShapeCache)

    case shape_cache.fetch_snapshot(table) do
      {:ok, shape_id, snapshot} ->
        {:ok, shape_id, snapshot}

      :error ->
        case shape_cache.create_or_wait_snapshot(table) do
          :ready -> shape_cache.fetch_snapshot(table)
          {:error, error} -> {:error, error}
        end
    end
  end
end
