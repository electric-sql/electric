defmodule Electric.DDLX.Command.Grant do
  alias Electric.DDLX.Command
  alias Electric.Satellite.SatPerms, as: P

  import Electric.DDLX.Parser.Build, except: [validate_scope_information: 2]

  @type t() :: %__MODULE__{
          privileges: [String.t()],
          on_table: String.t(),
          role: String.t(),
          column_names: [String.t()],
          scope: String.t(),
          using_path: String.t(),
          check_fn: String.t()
        }

  @keys [
    :privileges,
    :on_table,
    :role,
    :column_names,
    :scope,
    :using_path,
    :check_fn
  ]

  @enforce_keys @keys

  defstruct @keys

  def build(params, opts) do
    with {:ok, table_schema} <- fetch_attr(params, :table_schema, default_schema(opts)),
         {:ok, table_name} <- fetch_attr(params, :table_name),
         {:ok, column_names} <- fetch_attr(params, :column_names, ["*"]),
         {:ok, role_attrs} <- validate_scope_information(params, opts),
         {:ok, privileges} <- fetch_attr(params, :privilege),
         {:ok, using_path} <- fetch_attr(params, :using, nil),
         {:ok, check_fn} <- fetch_attr(params, :check, nil) do
      {role, role_attrs} = Keyword.pop!(role_attrs, :role_name)
      scope = Keyword.get(role_attrs, :scope, nil) || "__global__"

      {:ok,
       struct(
         __MODULE__,
         on_table: {table_schema, table_name},
         column_names: column_names,
         role: role,
         scope: scope,
         privileges: privileges,
         using_path: using_path,
         check_fn: check_fn
       )}
    end
  end

  defp validate_scope_information(params, opts) do
    with {:ok, role_name} <- fetch_attr(params, :role_name),
         {:ok, attrs} <- split_role_def(role_name, opts),
         attrs = maybe_add_scope(attrs, params, opts) do
      {:ok, attrs}
    end
  end

  defp maybe_add_scope(attrs, params, opts) do
    if !attrs[:scope] do
      with {:ok, scope_table_name} <- fetch_attr(params, :scope_table_name) do
        {:ok, scope_schema_name} =
          fetch_attr(params, :scope_schema_name, default_schema(opts))

        Keyword.put(attrs, :scope, {scope_schema_name, scope_table_name})
      else
        _ -> attrs
      end
    else
      attrs
    end
  end

  defimpl Command do
    import Electric.DDLX.Command.Common

    def pg_sql(grant) do
      for privilege <- grant.privileges do
        """
        CALL electric.grant(
          privilege_name => #{sql_repr(privilege)},
          on_table_name => #{sql_repr(grant.on_table)},
          role_name => #{sql_repr(grant.role)},
          columns => #{sql_repr(grant.column_names)},
          scope_name => #{sql_repr(grant.scope)},
          using_path => #{sql_repr(grant.using_path)},
          check_fn => #{sql_repr(grant.check_fn)});
        """
      end
    end

    def table_name(%{on_table: table_name}) do
      table_name
    end

    def tag(_a), do: "ELECTRIC GRANT"

    def to_protobuf(grant) do
      %{on_table: {schema, name}} = grant

      [
        %P.Grant{
          table: %P.Table{schema: schema, name: name},
          role: pb_role(grant.role),
          privileges: pb_privs(grant.privileges),
          columns: grant.column_names,
          scope: scope(grant),
          path: grant.using_path,
          check: grant.check_fn
        }
      ]
    end

    defp pb_role("__electric__.__authenticated__") do
      %P.RoleName{role: {:predefined, :AUTHENTICATED}}
    end

    defp pb_role("__electric__.__anyone__") do
      %P.RoleName{role: {:predefined, :ANYONE}}
    end

    defp pb_role(role) when is_binary(role) do
      %P.RoleName{role: {:application, role}}
    end

    defp scope(%{scope: {ss, sn}}) do
      %P.Table{schema: ss, name: sn}
    end

    defp scope(_), do: nil

    defp pb_privs(privs) do
      Enum.map(privs, &priv_to_pb/1)
    end

    defp priv_to_pb(p) do
      case p do
        "update" -> :UPDATE
        "select" -> :SELECT
        "delete" -> :DELETE
        "insert" -> :INSERT
      end
    end
  end
end
