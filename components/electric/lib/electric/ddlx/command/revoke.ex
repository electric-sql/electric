defmodule Electric.DDLX.Command.Revoke do
  alias Electric.DDLX.Command

  @type t() :: %__MODULE__{
          privilege: String.t(),
          on_table: String.t(),
          role: String.t(),
          column_names: [String.t()],
          scope: String.t()
        }

  @keys [
    :privilege,
    :on_table,
    :role,
    :column_names,
    :scope
  ]

  @enforce_keys @keys

  defstruct @keys

  defimpl Command do
    import Electric.DDLX.Command.Common

    def pg_sql(revoke) do
      [
        """
        SELECT electric.revoke(#{sql_repr(revoke.privilege)}, #{sql_repr(revoke.on_table)}, #{sql_repr(revoke.role)}, #{sql_repr(revoke.column_names)}, #{sql_repr(revoke.scope)});
        """
      ]
    end

    def table_name(%{on_table: table_name}) do
      table_name
    end

    def tag(_a), do: "ELECTRIC REVOKE"
  end
end
