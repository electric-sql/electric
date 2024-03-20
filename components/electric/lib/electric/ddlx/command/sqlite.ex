defmodule Electric.DDLX.Command.SQLite do
  alias Electric.DDLX.Command
  alias Electric.Satellite.SatPerms

  import Electric.DDLX.Parser.Build

  def build(params, _opts, ddlx) do
    with {:ok, stmt} <- fetch_attr(params, :statement) do
      {:ok,
       %Command{
         cmds: %SatPerms.DDLX{sqlite: [%SatPerms.Sqlite{stmt: stmt}]},
         stmt: ddlx,
         tables: [],
         tag: "ELECTRIC SQLITE"
       }}
    end
  end
end
