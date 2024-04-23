defprotocol Electric.DDLX.Command.PgSQL do
  @spec to_sql(t()) :: [String.t()]
  def to_sql(cmd)
end

alias Electric.Satellite.SatPerms

defmodule Electric.DDLX.Command do
  alias Electric.DDLX
  alias Electric.DDLX.Command.PgSQL

  defstruct [:action, :stmt, :tag, tables: []]

  @type t() :: %__MODULE__{
          action: struct(),
          stmt: String.t(),
          tag: String.t(),
          tables: [Electric.Postgres.relation()]
        }

  def tag(%__MODULE__{tag: tag}) do
    tag
  end

  @perms_with_ids [:assigns, :unassigns, :grants, :revokes]
  @perms_without_ids [:sqlite]

  def ddlx(cmds) do
    ddlx =
      Enum.reduce(@perms_with_ids, %SatPerms.DDLX{}, fn type, ddlx ->
        Map.update!(ddlx, type, fn [] ->
          cmds
          |> Keyword.get(type, [])
          |> Enum.map(&put_id/1)
        end)
      end)

    Enum.reduce(@perms_without_ids, ddlx, &Map.put(&2, &1, Keyword.get(cmds, &1, [])))
  end

  def put_id(%{id: id} = cmd) when is_struct(cmd) and id in ["", nil] do
    Map.put(cmd, :id, command_id(cmd))
  end

  def put_id(cmd) when is_struct(cmd) do
    cmd
  end

  def pg_sql(cmd) do
    PgSQL.to_sql(cmd)
  end

  def table_names(%__MODULE__{tables: tables}), do: tables

  def enabled?(%__MODULE__{action: cmd}) do
    command_enabled?(cmd)
  end

  def electric_enable({_, _} = table) do
    table_name = Electric.Utils.inspect_relation(table)

    %__MODULE__{
      action: %DDLX.Command.Enable{table_name: table_name},
      stmt: "CALL electric.electrify('#{table_name}');",
      tag: "ELECTRIC ENABLE",
      tables: [table]
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

  def command_id(%SatPerms.Sqlite{} = sqlite) do
    hash([
      sqlite.stmt
    ])
  end

  # hash the given terms in the struct together. `SHA1` is chosen because it is smaller in terms
  # of bytes, rather than for any cryptographic reason. Since the hash/id is used in the naming of
  # triggers and tables within pg, a bigger hash, such as `SHA256`, would use too many of the 64
  # available bytes for these pg objects. This is the same reason to use encode32 rather than
  # encode16 -- it just eats fewer of the available characters.
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
    def to_sql(%Electric.DDLX.Command{action: action}) do
      PgSQL.to_sql(action)
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
  def to_sql(%SatPerms.Assign{} = _assign) do
    []
  end
end

defimpl Electric.DDLX.Command.PgSQL, for: SatPerms.Unassign do
  def to_sql(%SatPerms.Unassign{} = _unassign) do
    []
  end
end

defimpl Electric.DDLX.Command.PgSQL, for: SatPerms.Sqlite do
  def to_sql(%SatPerms.Sqlite{} = _sqlite) do
    []
  end
end
