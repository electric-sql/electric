defmodule Electric.DDLX.Command.Assign do
  alias Electric.DDLX.Command
  alias Electric.Satellite.SatPerms

  import Electric.DDLX.Parser.Build

  def build(params, opts, ddlx) do
    with {:ok, user_table_schema} <- fetch_attr(params, :user_table_schema, default_schema(opts)),
         {:ok, user_table_name} <- fetch_attr(params, :user_table_name),
         {:ok, user_column} <- fetch_attr(params, :user_table_column),
         {:ok, role_attrs} <-
           validate_role_information(params, user_table_schema, user_table_name, opts),
         {:ok, scope_attrs} <- validate_scope_information(params, opts),
         {:ok, if_statement} <- fetch_attr(params, :if, nil) do
      user_attrs = [
        table_name: {user_table_schema, user_table_name},
        user_column: user_column,
        if_statement: if_statement
      ]

      attrs = Enum.reduce([scope_attrs, user_attrs, role_attrs], [], &Keyword.merge/2)

      {:ok,
       %Command{
         cmds: %SatPerms.DDLX{
           assigns: [
             %SatPerms.Assign{
               table: pb_table(attrs[:table_name]),
               user_column: attrs[:user_column],
               role_column: attrs[:role_column],
               role_name: attrs[:role_name],
               scope: pb_scope(attrs[:scope]),
               if: attrs[:if_statement]
             }
           ]
         },
         stmt: ddlx,
         tables: [attrs[:table_name]],
         tag: "ELECTRIC ASSIGN"
       }}
    end
  end
end
