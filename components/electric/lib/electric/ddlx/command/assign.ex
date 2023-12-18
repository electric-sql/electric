defmodule Electric.DDLX.Command.Assign do
  alias Electric.DDLX.Command

  import Electric.DDLX.Parser.Build

  @type t() :: %__MODULE__{
          table_name: String.t(),
          user_column: String.t(),
          scope: String.t(),
          role_name: String.t(),
          role_column: String.t(),
          if_statement: String.t()
        }

  defstruct [
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

  defimpl Command do
    alias Electric.Satellite.SatPerms, as: P

    import Electric.DDLX.Command.Common

    def pg_sql(assign) do
      [
        """
        CALL electric.assign(
          assign_table_full_name => #{sql_repr(assign.table_name)},
          scope => #{sql_repr(assign.scope)},
          user_column_name => #{sql_repr(assign.user_column)},
          role_name_string => #{sql_repr(assign.role_name)},
          role_column_name => #{sql_repr(assign.role_column)},
          if_fn => #{sql_repr(assign.if_statement)}
        );
        """
      ]
    end

    def table_name(%{table_name: table_name}) do
      table_name
    end

    def tag(_a), do: "ELECTRIC ASSIGN"

    def to_protobuf(assign) do
      %{table_name: {table_schema, table_name}} = assign

      scope =
        case assign do
          %{scope: {scope_schema, scope_name}} ->
            %P.Table{schema: scope_schema, name: scope_name}

          %{scope: nil} ->
            nil
        end

      [
        %P.Assign{
          # id: assign.id,
          table: %P.Table{schema: table_schema, name: table_name},
          user_column: assign.user_column,
          role_column: assign.role_column,
          role_name: assign.role_name,
          scope: scope,
          if: assign.if_statement
        }
      ]
    end
  end
end
