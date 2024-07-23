defmodule Electric.Shapes.Querying do
  alias Electric.Utils
  alias Electric.Shapes.Shape
  alias Electric.Postgres.Inspector

  @type row :: [term()]

  @spec stream_initial_data(DBConnection.t(), Shape.t()) ::
          {Postgrex.Query.t(), Enumerable.t(row())}
  def stream_initial_data(conn, %Shape{root_table: root_table} = shape) do
    table = Utils.relation_to_sql(root_table)

    where =
      if not is_nil(shape.where), do: " WHERE " <> shape.where.query, else: ""

    query =
      Postgrex.prepare!(
        conn,
        table,
        ~s|SELECT #{columns(root_table, conn)} FROM #{table} #{where}|
      )

    stream =
      Postgrex.stream(conn, query, [])
      |> Stream.flat_map(& &1.rows)

    {query, stream}
  end

  defp columns(root_table, conn) do
    root_table
    |> Inspector.load_table_info(conn)
    |> Enum.map(&~s("#{Utils.escape_quotes(&1.name)}"::text))
    |> Enum.join(", ")
  end
end
