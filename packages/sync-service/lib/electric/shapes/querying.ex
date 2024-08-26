defmodule Electric.Shapes.Querying do
  alias Electric.Replication.LogOffset
  alias Electric.LogItems
  alias Electric.Utils
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  @type row :: [term()]

  @typedoc """
  Postgres row, serialized to JSON log format, in `iodata` form for ease of writing to files.
  """
  @type json_iodata :: iodata()

  @type json_result_stream :: Enumerable.t(json_iodata())

  @spec stream_initial_data(DBConnection.t(), Shape.t()) :: json_result_stream()
  def stream_initial_data(conn, %Shape{root_table: root_table, table_info: table_info} = shape) do
    OpenTelemetry.with_span("querying.stream_initial_data", [], fn ->
      table = Utils.relation_to_sql(root_table)

      where =
        if not is_nil(shape.where), do: " WHERE " <> shape.where.query, else: ""

      query =
        Postgrex.prepare!(
          conn,
          table,
          ~s|SELECT #{columns(table_info, root_table)} FROM #{table} #{where}|
        )

      Postgrex.stream(conn, query, [])
      |> Stream.flat_map(& &1.rows)
      |> LogItems.from_snapshot_row_stream(LogOffset.first(), shape, query)
      |> Stream.map(&Jason.encode_to_iodata!/1)
    end)
  end

  defp columns(table_info, root_table) do
    table_info
    |> Map.fetch!(root_table)
    |> Map.fetch!(:columns)
    |> Enum.map(&~s("#{Utils.escape_quotes(&1.name)}"::text))
    |> Enum.join(", ")
  end
end
