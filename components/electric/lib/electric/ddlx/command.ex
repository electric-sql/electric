defprotocol Electric.DDLX.Command.PgSQL do
  @spec to_sql(t()) :: [String.t()]
  def to_sql(cmd)
end

alias Electric.Satellite.SatPerms

defmodule Electric.DDLX.Command do
  alias Electric.DDLX
  alias Electric.DDLX.Command.PgSQL

  defstruct [:cmds, :stmt, :tag, tables: []]

  def tag(%__MODULE__{tag: tag}), do: tag

  def pg_sql(cmd) do
    PgSQL.to_sql(cmd)
  end

  def table_names(%__MODULE__{tables: tables}), do: tables

  def enabled?(%__MODULE__{cmds: cmd}) do
    command_enabled?(cmd)
  end

  def electric_enable({_, _} = table) do
    table_name = Electric.Utils.inspect_relation(table)

    %__MODULE__{
      tag: "ELECTRIC ENABLE",
      tables: [table],
      cmds: %DDLX.Command.Enable{table_name: table_name},
      stmt: "CALL electric.electrify('#{table_name}');"
    }
  end

  # shortcut the enable command, which has to be enabled
  defp command_enabled?(%DDLX.Command.Enable{}), do: true
  defp command_enabled?(%DDLX.Command.Disable{}), do: false

  defp command_enabled?(%SatPerms.DDLX{} = ddlx) do
    ddlx
    |> command_list()
    |> Enum.map(&feature_flag/1)
    |> Enum.all?(&Electric.Features.enabled?/1)
  end

  def command_list(%SatPerms.DDLX{} = ddlx) do
    Stream.concat([ddlx.grants, ddlx.revokes, ddlx.assigns, ddlx.unassigns])
  end

  @feature_flags %{
    SatPerms.Grant => :proxy_ddlx_grant,
    SatPerms.Revoke => :proxy_ddlx_revoke,
    SatPerms.Assign => :proxy_ddlx_assign,
    SatPerms.Unassign => :proxy_ddlx_unassign,
    SatPerms.Sqlite => :proxy_ddlx_sqlite
  }

  # either we have a specific flag for the command or we fallback to the
  # default setting for the features module, which is `false`
  defp feature_flag(%cmd{}) do
    @feature_flags[cmd] || Electric.Features.default_key()
  end

  def command_id(%SatPerms.Grant{} = grant) do
    hash([
      grant.table,
      grant.role,
      grant.scope,
      grant.privilege
    ])
  end

  def command_id(%SatPerms.Revoke{} = revoke) do
    hash([
      revoke.table,
      revoke.role,
      revoke.scope,
      revoke.privilege
    ])
  end

  def command_id(%SatPerms.Assign{} = assign) do
    hash([
      assign.table,
      assign.user_column,
      assign.role_column,
      assign.role_name,
      assign.scope
    ])
  end

  def command_id(%SatPerms.Unassign{} = unassign) do
    hash([
      unassign.table,
      unassign.user_column,
      unassign.role_column,
      unassign.role_name,
      unassign.scope
    ])
  end

  defp hash(terms) do
    terms
    |> Enum.map(&fingerprint/1)
    |> Enum.intersperse("\n")
    |> then(&:crypto.hash(:sha, &1))
    |> Base.encode32(case: :lower, padding: false)
  end

  defp fingerprint(nil) do
    <<0>>
  end

  defp fingerprint(string) when is_binary(string) do
    string
  end

  defp fingerprint(%SatPerms.Table{} = table) do
    [table.schema, ".", table.name]
  end

  defp fingerprint(%SatPerms.RoleName{role: {:predefined, :AUTHENTICATED}}) do
    "__electric__.__authenticated__"
  end

  defp fingerprint(%SatPerms.RoleName{role: {:predefined, :ANYONE}}) do
    "__electric__.__anyone__"
  end

  defp fingerprint(%SatPerms.RoleName{role: {:application, role}}) do
    role
  end

  defp fingerprint(priv) when priv in [:SELECT, :INSERT, :UPDATE, :DELETE] do
    to_string(priv)
  end

  defimpl Electric.DDLX.Command.PgSQL do
    def to_sql(%Electric.DDLX.Command{cmds: cmds}) do
      PgSQL.to_sql(cmds)
    end
  end
end

defimpl Electric.DDLX.Command.PgSQL, for: SatPerms.DDLX do
  alias Electric.Postgres.Extension

  def to_sql(%SatPerms.DDLX{} = ddlx) do
    Enum.concat([
      serialise_ddlx(ddlx),
      ddlx
      |> Electric.DDLX.Command.command_list()
      |> Enum.flat_map(&Electric.DDLX.Command.PgSQL.to_sql/1)
    ])
  end

  defp serialise_ddlx(ddlx) do
    encoded = Protox.encode!(ddlx) |> IO.iodata_to_binary() |> Base.encode16()

    [
      "INSERT INTO #{Extension.ddlx_table()} (ddlx) VALUES ('\\x#{encoded}'::bytea);"
    ]
  end
end

defimpl Electric.DDLX.Command.PgSQL, for: SatPerms.Grant do
  def to_sql(%SatPerms.Grant{} = _grant) do
    []
  end
end

defimpl Electric.DDLX.Command.PgSQL, for: SatPerms.Revoke do
  def to_sql(%SatPerms.Revoke{} = _revoke) do
    []
  end
end

defimpl Electric.DDLX.Command.PgSQL, for: SatPerms.Assign do
  import Electric.DDLX.Command.Common

  def to_sql(%SatPerms.Assign{} = assign) do
    id = Electric.DDLX.Command.command_id(assign)

    [
      """
      CALL electric.assign(
        assignment_id => #{sql_repr(id)},
        assign_table_full_name => #{sql_repr(assign.table)},
        scope => #{sql_repr(assign.scope)},
        user_column_name => #{sql_repr(assign.user_column)},
        role_name_string => #{sql_repr(assign.role_name)},
        role_column_name => #{sql_repr(assign.role_column)},
        if_fn => #{sql_repr(assign.if)}
      );
      """
    ]
  end
end

defimpl Electric.DDLX.Command.PgSQL, for: SatPerms.Unassign do
  import Electric.DDLX.Command.Common

  def to_sql(%SatPerms.Unassign{} = unassign) do
    id = Electric.DDLX.Command.command_id(unassign)

    [
      """
      CALL electric.unassign(
        assignment_id => #{sql_repr(id)},
        assign_table_full_name => #{sql_repr(unassign.table)},
        scope => #{sql_repr(unassign.scope)},
        user_column_name => #{sql_repr(unassign.user_column)},
        role_name_string => #{sql_repr(unassign.role_name)},
        role_column_name => #{sql_repr(unassign.role_column)}
      );
      """
    ]
  end
end

defimpl Electric.DDLX.Command.PgSQL, for: SatPerms.Sqlite do
  def to_sql(%SatPerms.Sqlite{stmt: stmt}) when is_binary(stmt) do
    [
      """
      CALL electric.sqlite(sql => $sqlite$#{stmt}$sqlite$);
      """
    ]
  end
end
