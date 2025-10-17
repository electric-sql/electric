defmodule Electric.Plug.OptionsShapePlug do
  use Plug.Builder

  plug :call_options_api

  defp call_options_api(%Plug.Conn{} = conn, _) do
    Electric.Shapes.Api.options(conn)
  end
end
