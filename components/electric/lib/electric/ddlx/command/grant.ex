defmodule Electric.DDLX.Command.Grant do
  alias Electric.DDLX.Command

  @type t() :: %__MODULE__{
          privilege: String.t(),
          on_table: String.t(),
          role: String.t(),
          column_names: [String.t()],
          scope: String.t(),
          using_path: String.t(),
          check_fn: String.t()
        }

  @keys [
    :privilege,
    :on_table,
    :role,
    :column_names,
    :scope,
    :using_path,
    :check_fn
  ]

  @enforce_keys @keys

  defstruct @keys

  defimpl Command do
    import Electric.DDLX.Command.Common

    def pg_sql(grant) do
      [
        """
        CALL electric.grant(privilege_name => #{sql_repr(grant.privilege)},
          on_table_name => #{sql_repr(grant.on_table)},
          role_name => #{sql_repr(grant.role)},
          columns => #{sql_repr(grant.column_names)},
          scope_name => #{sql_repr(grant.scope)},
          using_path => #{sql_repr(grant.using_path)},
          check_fn => #{sql_repr(grant.check_fn)});
        """
      ]
    end

    def table_name(%{on_table: table_name}) do
      table_name
    end

    def tag(_a), do: "ELECTRIC GRANT"
  end
end
