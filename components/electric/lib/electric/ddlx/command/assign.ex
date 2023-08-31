defmodule Electric.DDLX.Command.Assign do
  alias Electric.DDLX.Command

  @type t() :: %__MODULE__{
          schema_name: String.t(),
          table_name: String.t(),
          user_column: String.t(),
          scope: String.t(),
          role_name: String.t(),
          role_column: String.t(),
          if_statement: String.t()
        }

  @keys [
    :schema_name,
    :table_name,
    :user_column,
    :scope,
    :role_name,
    :role_column,
    :if_statement
  ]

  @enforce_keys @keys

  defstruct @keys

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
