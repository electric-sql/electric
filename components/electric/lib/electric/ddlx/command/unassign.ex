defmodule Electric.DDLX.Command.Unassign do
  alias Electric.DDLX.Command

  @type t() :: %__MODULE__{
          schema_name: String.t(),
          table_name: String.t(),
          user_column: String.t(),
          scope: String.t(),
          role_name: String.t(),
          role_column: String.t()
        }

  @keys [
    :schema_name,
    :table_name,
    :user_column,
    :scope,
    :role_name,
    :role_column
  ]

  @enforce_keys @keys

  defstruct @keys

  defimpl Command do
    import Electric.DDLX.Command.Common

    def pg_sql(unassign) do
      [
        """
        CALL electric.unassign(assign_schema => #{sql_repr(unassign.schema_name)},
          assign_table => #{sql_repr(unassign.table_name)},
          scope => #{sql_repr(unassign.scope)},
          user_column_name => #{sql_repr(unassign.user_column)},
          role_name_string => #{sql_repr(unassign.role_name)},
          role_column_name => #{sql_repr(unassign.role_column)});
        """
      ]
    end

    def table_name(%{table_name: table_name}) do
      table_name
    end

    def tag(_a), do: "ELECTRIC UNASSIGN"
  end
end
