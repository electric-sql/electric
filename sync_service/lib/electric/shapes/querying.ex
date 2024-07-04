defmodule Electric.Shapes.Querying do
  alias Electric.Shapes.Shape

  def stream_initial_data(conn, %Shape{} = shape) do
    {schema, table} = shape.root_table

    query =
      Postgrex.prepare!(
        conn,
        ~s|"#{schema}"."#{table}"|,
        ~s|SELECT * FROM "#{schema}"."#{table}"|
      )

    stream =
      Postgrex.stream(conn, query, [])
      |> Stream.flat_map(& &1.rows)

    {query, stream}
  end
end
