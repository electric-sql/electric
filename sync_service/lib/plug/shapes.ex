defmodule Electric.Plug.Shapes do
  use Plug.Router
  alias Electric.Shapes

  plug(:match)
  plug(:dispatch)

  get "/:table" do
    conn
    |> put_resp_header("x-electric-shape-id", "blah")
    |> put_resp_content_type("application/json")
    |> send_resp(
      200,
      Jason.encode!(
        (Shapes.query_shape(table)
         |> Enum.with_index(fn row, index ->
           %{
             key: row["id"],
             value: row,
             headers: %{action: "insert"},
             offset: index
           }
         end)) ++
          [
            %{
              headers: %{control: "up-to-date"}
            }
          ]
      )
    )
  end
end
