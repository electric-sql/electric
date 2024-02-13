defmodule Electric.DDLX.Command.Revoke do
  alias Electric.DDLX.Command
  alias Electric.Satellite.SatPerms

  import Electric.DDLX.Parser.Build

  def build(params, opts, ddlx) do
    with {:ok, table_schema} <- fetch_attr(params, :table_schema, default_schema(opts)),
         {:ok, table_name} <- fetch_attr(params, :table_name),
         {:ok, _columns} <- protobuf_columns(Keyword.get(params, :column_names, nil), ddlx),
         {:ok, scope} <- validate_scope_information(params, opts),
         {:ok, role_name} <- fetch_attr(params, :role_name),
         {:ok, privileges} <- fetch_attr(params, :privilege) do
      revokes =
        for privilege <- protobuf_privs(privileges) do
          %SatPerms.Revoke{
            table: protobuf_table(table_schema, table_name),
            role: protobuf_role(role_name),
            scope: protobuf_scope(scope[:scope]),
            privilege: privilege
          }
        end

      {:ok,
       %Command{
         action: %SatPerms.DDLX{
           revokes: revokes
         },
         stmt: ddlx,
         tables: [{table_schema, table_name}],
         tag: "ELECTRIC REVOKE"
       }}
    end
  end
end
