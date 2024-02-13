defmodule Electric.DDLX.Command.Revoke do
  alias Electric.DDLX.Command
  alias Electric.Satellite.SatPerms

  import Electric.DDLX.Parser.Build

  def build(params, opts, ddlx) do
    with {:ok, table_schema} <- fetch_attr(params, :table_schema, default_schema(opts)),
         {:ok, table_name} <- fetch_attr(params, :table_name),
         {:ok, _columns} <- pb_columns(Keyword.get(params, :column_names, nil), ddlx),
         {:ok, scope} <- validate_scope_information(params, opts),
         {:ok, role_name} <- fetch_attr(params, :role_name),
         {:ok, privileges} <- fetch_attr(params, :privilege) do
      revokes =
        for privilege <- pb_privs(privileges) do
          %SatPerms.Revoke{
            table: pb_table(table_schema, table_name),
            role: pb_role(role_name),
            scope: pb_scope(scope[:scope]),
            privilege: privilege
          }
        end

      {:ok,
       %Command{
         cmds: %SatPerms.DDLX{
           revokes: revokes
         },
         stmt: ddlx,
         tables: [{table_schema, table_name}],
         tag: "ELECTRIC REVOKE"
       }}
    end
  end
end
