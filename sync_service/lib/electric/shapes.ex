defmodule Electric.Shapes do
  alias Electric.Utils
  require Logger

  def query_snapshot(conn, table) do
    start = System.monotonic_time()
    query = Postgrex.query!(conn, "SELECT * FROM #{table}", [])
    query_stopped = System.monotonic_time()
    Logger.debug("Querying a snapshot for #{inspect(table)}")

    results =
      query.rows
      |> Enum.map(fn row ->
        Enum.zip_with(query.columns, row, fn
          "id", val -> {"id", Utils.encode_uuid(val)}
          col, val -> {col, val}
        end)
        |> Map.new()
      end)

    :telemetry.execute(
      [:electric, :query],
      %{
        duration: query_stopped - start,
        serialization_duration: System.monotonic_time() - query_stopped
      },
      %{}
    )

    results
  end

  def get_or_create_shape(table, opts \\ []) do
    shape_cache = Keyword.get(opts, :shape_cache, Electric.InMemShapeCache)

    case shape_cache.fetch_snapshot(table) do
      {:ok, shape_id, version, snapshot} ->
        {:ok, shape_id, version, snapshot}

      :error ->
        case shape_cache.create_or_wait_snapshot(table) do
          :ready -> shape_cache.fetch_snapshot(table)
          {:error, error} -> {:error, error}
        end
    end
  end
end
