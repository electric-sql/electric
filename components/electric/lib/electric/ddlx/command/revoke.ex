defmodule Electric.DDLX.Command.Revoke do
  alias Electric.DDLX.Command

  import Electric.DDLX.Parser.Build, except: [validate_scope_information: 2]

  @type t() :: %__MODULE__{
          privileges: [String.t()],
          on_table: String.t(),
          role: String.t(),
          column_names: [String.t()],
          scope: String.t()
        }

  @keys [
    :privileges,
    :on_table,
    :role,
    :column_names,
    :scope
  ]

  @enforce_keys @keys

  defstruct @keys

  def build(params, opts) do
    dbg(params)

    with {:ok, table_schema} <- fetch_attr(params, :table_schema, default_schema(opts)),
         {:ok, table_name} <- fetch_attr(params, :table_name),
         {:ok, column_names} <- fetch_attr(params, :column_names, ["*"]),
         {:ok, role_attrs} <- validate_scope_information(params, opts),
         {:ok, privileges} <- fetch_attr(params, :privilege) do
      {role, role_attrs} = Keyword.pop!(role_attrs, :role_name)
      scope = Keyword.get(role_attrs, :scope, nil) || "__global__"

      {:ok,
       struct(
         __MODULE__,
         on_table: {table_schema, table_name},
         column_names: column_names,
         role: role,
         scope: scope,
         privileges: Enum.map(privileges, &to_string/1)
       )}
    end
  end

  defp validate_scope_information(params, opts) do
    with {:ok, role_name} <- fetch_attr(params, :role_name),
         {:ok, attrs} <- split_role_def(role_name, opts) do
      {:ok, attrs}
    end
  end

  defimpl Command do
    import Electric.DDLX.Command.Common

    def pg_sql(revoke) do
      for privilege <- revoke.privileges do
        """
        CALL electric.revoke(
          #{sql_repr(privilege)},
          #{sql_repr(revoke.on_table)},
          #{sql_repr(revoke.role)},
          #{sql_repr(revoke.column_names)},
          #{sql_repr(revoke.scope)}
        );
        """
      end
    end

    def table_name(%{on_table: table_name}) do
      table_name
    end

    def tag(_a), do: "ELECTRIC REVOKE"
  end
end
