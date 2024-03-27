defmodule Electric.DDLX.Command.Unassign do
  alias Electric.DDLX.Command

  import Electric.DDLX.Parser.Build

  @type t() :: %__MODULE__{
          table_name: String.t(),
          user_column: String.t(),
          scope: String.t(),
          role_name: String.t(),
          role_column: String.t()
        }

  @keys [
    :table_name,
    :user_column,
    :scope,
    :role_name,
    :role_column
  ]

  @enforce_keys @keys

  defstruct @keys

  def build(params, opts) do
    with {:ok, user_table_schema} <- fetch_attr(params, :user_table_schema, default_schema(opts)),
         {:ok, user_table_name} <- fetch_attr(params, :user_table_name),
         {:ok, user_column} <- fetch_attr(params, :user_table_column),
         {:ok, role_attrs} <-
           validate_role_information(params, user_table_schema, user_table_name, opts),
         {:ok, scope_attrs} <- validate_scope_information(params, opts) do
      user_attrs = [
        table_name: {user_table_schema, user_table_name},
        user_column: user_column
      ]

      attrs = Enum.reduce([scope_attrs, user_attrs, role_attrs], [], &Keyword.merge/2)

      {:ok, struct(__MODULE__, attrs)}
    end
  end

  defimpl Command do
    import Electric.DDLX.Command.Common

    def pg_sql(unassign) do
      [
        """
        CALL electric.unassign(
          assign_table_full_name => #{sql_repr(unassign.table_name)},
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

    def to_protobuf(_), do: []
  end
end
