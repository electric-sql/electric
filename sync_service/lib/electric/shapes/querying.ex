defmodule Electric.Shapes.Querying do
  alias Electric.Utils
  alias Electric.Shapes.Shape

  @type row :: [term()]

  @spec stream_initial_data(DBConnection.t(), Shape.t()) ::
          {Postgrex.Query.t(), Enumerable.t(row())}
  def stream_initial_data(conn, %Shape{} = shape) do
    table = Utils.relation_to_sql(shape.root_table)

    where =
      if not is_nil(shape.where), do: " WHERE " <> shape.where.query, else: ""

    query =
      Postgrex.prepare!(
        conn,
        table,
        ~s|SELECT * FROM #{table} #{where}|
      )

    stream =
      Postgrex.stream(conn, query, [])
      |> Stream.flat_map(& &1.rows)

    {query, stream}
  end
end
