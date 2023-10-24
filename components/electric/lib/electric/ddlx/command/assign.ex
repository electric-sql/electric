defmodule Electric.DDLX.Command.Assign do
  alias Electric.DDLX.Command
  import Electric.DDLX.Parse.Build

  @type t() :: %__MODULE__{
          schema_name: String.t(),
          table_name: String.t(),
          user_column: String.t(),
          scope: String.t(),
          role_name: String.t(),
          role_column: String.t(),
          if_statement: String.t()
        }

  defstruct [
    :schema_name,
    :table_name,
    :user_column,
    :scope,
    :role_name,
    :role_column,
    :if_statement
  ]

  def build(params, opts) do
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

      {:ok, struct(__MODULE__, attrs)}
    end
  end

  defp validate_role_information(params, user_table_schema, user_table_name, opts) do
    # we must have a {role_table_name, role_column}
    # if the role_name is null then we must have role_table_name and role_column and
    # {role_table_schema, role_table_name} == {user_table_schema, user_table_name}
    # if the role name is not null, then we should split it at ":" to get a scope
    with {:ok, role_name} <- fetch_attr(params, :role_name),
         {:ok, attrs} <- split_role_def(role_name, opts) do
      {:ok, attrs}
    else
      _ ->
        validate_dynamic_role(params, user_table_schema, user_table_name, opts)
    end
  end

  defp validate_dynamic_role(params, user_table_schema, user_table_name, opts) do
    with {:ok, role_table_schema} <- fetch_attr(params, :role_table_schema, default_schema(opts)),
         {:ok, role_table_name} <- fetch_attr(params, :role_table_name),
         {:ok, role_column} <- fetch_attr(params, :role_table_column),
         # This is based on the assumption that the dynamic role value *MUST* come from the same table
         # as the user id
         {:ok, schema_name} <-
           attrs_equal(
             :role_table_schema,
             role_table_schema,
             :user_table_schema,
             user_table_schema
           ),
         {:ok, table_name} <-
           attrs_equal(:role_table_name, role_table_name, :user_table_name, user_table_name) do
      {:ok, role_table: {role_table_schema, role_table_name}, role_column: role_column}
    end
  end

  defp validate_scope_information(params, opts) do
    dbg(validate_scope_information: params)

    with {:ok, scope_schema_name} <- fetch_attr(params, :scope_schema_name, default_schema(opts)),
         {:ok, scope_table_name} <- fetch_attr(params, :scope_table_name) do
      {:ok, scope: {scope_schema_name, scope_table_name}}
    else
      _ -> {:ok, []}
    end
  end

  defimpl Command do
    import Electric.DDLX.Command.Common

    def pg_sql(assign) do
      [
        """
        CALL electric.assign(assign_schema => #{sql_repr(assign.schema_name)},
          assign_table => #{sql_repr(assign.table_name)},
          scope => #{sql_repr(assign.scope)},
          user_column_name => #{sql_repr(assign.user_column)},
          role_name_string => #{sql_repr(assign.role_name)},
          role_column_name => #{sql_repr(assign.role_column)},
          if_fn => #{sql_repr(assign.if_statement)});
        """
      ]
    end

    def table_name(%{table_name: table_name}) do
      table_name
    end

    def tag(_a), do: "ELECTRIC ASSIGN"
  end
end
