defmodule Electric.Shapes do
  alias Electric.Utils

  def query_shape(table) do
    query = Postgrex.query!(Electric.DbPool, "SELECT * FROM #{table}", [])

    query.rows
    |> Enum.map(fn row ->
      Enum.zip_with(query.columns, row, fn
        "id", val -> {"id", Utils.encode_uuid(val)}
        col, val -> {col, val}
      end)
      |> Map.new()
    end)
  end
end
