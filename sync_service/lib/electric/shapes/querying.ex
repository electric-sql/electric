defmodule Electric.Shapes.Querying do
  alias Electric.Shapes.Shape

  @type row :: [term()]

  @spec stream_initial_data(DBConnection.t(), Shape.t()) ::
          {Postgrex.Query.t(), Enumerable.t(row())}
  def stream_initial_data(conn, %Shape{} = shape) do
    {schema, table} = shape.root_table

    where =
      if not is_nil(shape.where), do: " WHERE " <> shape.where.query, else: ""

    query =
      Postgrex.prepare!(
        conn,
        ~s|"#{schema}"."#{table}"|,
        ~s|SELECT * FROM "#{schema}"."#{table}" #{where}|
      )

    stream =
      Postgrex.stream(conn, query, [])
      |> Stream.flat_map(& &1.rows)

    {query, stream}
  end
end
