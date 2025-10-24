defmodule Electric.Plug.PassAssignToOptsPlug do
  @behaviour Plug
  def init(plug: plug, assign_key: key) when is_atom(plug), do: {plug, key}
  def call(conn, {plug, key}), do: plug.call(conn, plug.init(conn.assigns[key]))
end
