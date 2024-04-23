defmodule Electric.DDLX.Command.Grant do
  alias Electric.DDLX.Command
  alias Electric.Satellite.SatPerms

  import Electric.DDLX.Parser.Build

  def build(params, opts, ddlx) do
    with {:ok, table_schema} <- fetch_attr(params, :table_schema, default_schema(opts)),
         {:ok, table_name} <- fetch_attr(params, :table_name),
         {:ok, columns} <- protobuf_columns(Keyword.get(params, :column_names, nil), ddlx),
         {:ok, scope} <- validate_scope_information(params, opts),
         {:ok, role_name} <- fetch_attr(params, :role_name),
         {:ok, privileges} <- fetch_attr(params, :privilege),
         {:ok, using_path} <- fetch_attr(params, :using, nil),
         {:ok, check_fn} <- fetch_attr(params, :check, nil) do
      grants =
        for privilege <- protobuf_privs(privileges) do
          %SatPerms.Grant{
            table: protobuf_table(table_schema, table_name),
            columns: columns,
            role: protobuf_role(role_name),
            scope: protobuf_scope(scope[:scope]),
            privilege: privilege,
            path: using_path,
            check: check_fn
          }
        end

      {:ok,
       %Command{
         action: Command.ddlx(grants: grants),
         stmt: ddlx,
         tables: [{table_schema, table_name}],
         tag: "ELECTRIC GRANT"
       }}
    end
  end
end
