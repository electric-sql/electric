defmodule ApiWeb.Plugs.AssignShape do
  @moduledoc """
  This plug builds a shape definition from the request parameters and
  assigns it to the conn.
  """
  use ApiWeb, :plug

  alias Api.Shape

  def init(opts), do: opts

  # If you pass `table_from_path: true` as an option, then it reads the
  # tablename from the path. This is useful for using hardcoded paths to
  # specific shapes with `Gateway.Plug`, e.g.;
  #
  #     post "/items", Gateway.Plug, shape: Electric.Client.shape!("items")
  #
  def call(%{params: params} = conn, [{:table_from_path, true} | opts]) do
    table_name = Enum.at(conn.path_info, -1)

    params = Map.put(params, "table", table_name)

    conn
    |> Map.put(:params, params)
    |> call(opts)
  end

  def call(%{params: params} = conn, _opts) do
    case Shape.from(params) do
      {:ok, shape} ->
        conn
        |> assign(:shape, shape)

      _alt ->
        conn
        |> send_resp(400, "Invalid")
        |> halt()
    end
  end
end
