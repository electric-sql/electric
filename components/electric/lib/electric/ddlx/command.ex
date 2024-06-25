defprotocol Electric.DDLX.Command.PgSQL do
  alias Electric.Postgres.Schema

  @spec to_sql(t(), [String.t()], (String.t() -> String.t())) :: [String.t()]
  def to_sql(cmd, ddl_capture, quote_fun)

  @spec validate_schema(t(), Schema.t(), MapSet.t()) ::
          {:ok, [String.t()]} | {:error, %{optional(:code) => String.t(), message: String.t()}}
  def validate_schema(cmd, schema, electrified)
end

alias Electric.Satellite.SatPerms

defmodule Electric.DDLX.Command do
  alias Electric.DDLX
  alias Electric.DDLX.Command.PgSQL
  alias Electric.Postgres.Proxy.Injector

  defstruct [:action, :stmt, :tag, tables: []]

  @type t() :: %__MODULE__{
          action: struct(),
          stmt: String.t(),
          tag: String.t(),
          tables: [Electric.Postgres.relation()]
        }

  @privileges Electric.Satellite.Permissions.privileges()

  def tag(%__MODULE__{tag: tag}) do
    tag
  end

  def statement(%__MODULE__{stmt: stmt}) do
    stmt
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

  def proxy_sql(cmd) do
    proxy_sql(cmd, [], &Injector.quote_query/1)
  end

  def proxy_sql(cmd, ddl) do
    proxy_sql(cmd, ddl, &Injector.quote_query/1)
  end

  def proxy_sql(cmd, ddl, quote_fun) do
    PgSQL.to_sql(cmd, List.wrap(ddl), quote_fun)
  end

  def validate_schema(cmd, schema, electrified) do
    PgSQL.validate_schema(cmd, schema, electrified)
  end

  def table_names(%__MODULE__{tables: tables}), do: tables

  def electric_enable({_, _} = table) do
    table_name = Electric.Utils.inspect_relation(table)

    %__MODULE__{
      action: %DDLX.Command.Enable{table_name: table},
      stmt: "CALL electric.electrify('#{table_name}');",
      tag: "ELECTRIC ENABLE",
      tables: [table]
    }
  end

  def command_list(%__MODULE__{action: %SatPerms.DDLX{} = ddlx}) do
    command_list(ddlx)
  end

  def command_list(%SatPerms.DDLX{} = ddlx) do
    Stream.concat([ddlx.grants, ddlx.revokes, ddlx.assigns, ddlx.unassigns, ddlx.sqlite])
  end

  def enabled?(%__MODULE__{action: cmd}) do
    command_enabled?(cmd)
  end

  # shortcut the enable command, which has to be enabled
  defp command_enabled?(%DDLX.Command.Enable{}), do: true
  defp command_enabled?(%DDLX.Command.Disable{}), do: false

  defp command_enabled?(%SatPerms.DDLX{} = ddlx) do
    ddlx
    |> command_list()
    |> Enum.all?(&ddlx_enabled?/1)
  end

  @write_privileges Electric.Satellite.Permissions.write_privileges()

  defp ddlx_enabled?(%SatPerms.Grant{privilege: p}) when p in @write_privileges do
    Electric.Features.enabled?(:proxy_grant_write_permissions)
  end

  defp ddlx_enabled?(%m{})
       when m in [SatPerms.Grant, SatPerms.Revoke, SatPerms.Assign, SatPerms.Unassign] do
    true
  end

  defp ddlx_enabled?(%SatPerms.Sqlite{}) do
    Electric.Features.enabled?(:proxy_ddlx_sqlite)
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

  defp fingerprint(priv) when priv in @privileges do
    to_string(priv)
  end

  defimpl Electric.DDLX.Command.PgSQL do
    alias Electric.DDLX.Command

    def to_sql(%Electric.DDLX.Command{action: action}, ddl_capture, quote_fun) do
      Command.PgSQL.to_sql(action, ddl_capture, quote_fun)
    end

    def validate_schema(%Electric.DDLX.Command{action: action}, schema, electrified) do
      Command.PgSQL.validate_schema(action, schema, electrified)
    end
  end
end

alias Electric.DDLX.Command

defimpl Command.PgSQL, for: List do
  alias Command

  def to_sql(list, ddl_capture, quote_fun) do
    Enum.flat_map(list, &Command.PgSQL.to_sql(&1, ddl_capture, quote_fun))
  end

  def validate_schema(list, schema, electrified) do
    Enum.reduce_while(list, {:ok, []}, fn cmd, {:ok, warnings} ->
      case Command.PgSQL.validate_schema(cmd, schema, electrified) do
        {:ok, w} ->
          {:cont, {:ok, warnings ++ w}}

        {:error, reason} ->
          {:halt, {:error, reason}}
      end
    end)
  end
end

defimpl Command.PgSQL, for: SatPerms.DDLX do
  alias Command

  def to_sql(%SatPerms.DDLX{}, _ddl_capture, _quote_fun) do
    []
  end

  def validate_schema(%SatPerms.DDLX{} = ddlx, schema, electrified) do
    ddlx
    |> Command.command_list()
    |> Enum.to_list()
    |> Command.PgSQL.validate_schema(schema, electrified)
  end
end

defimpl Command.PgSQL, for: SatPerms.Grant do
  alias Electric.Postgres.Schema.Validator

  def to_sql(%SatPerms.Grant{} = _grant, _ddl_capture, _quote_fun) do
    []
  end

  def validate_schema(%SatPerms.Grant{} = grant, schema, _electrified) do
    Validator.validate_schema_for_grant(schema, grant)
  end
end

defimpl Command.PgSQL, for: SatPerms.Revoke do
  def to_sql(%SatPerms.Revoke{} = _revoke, _ddl_capture, _quote_fun) do
    []
  end

  def validate_schema(%SatPerms.Revoke{}, _schema, _electrified) do
    {:ok, []}
  end
end

defimpl Command.PgSQL, for: SatPerms.Assign do
  def to_sql(%SatPerms.Assign{} = _assign, _ddl_capture, _quote_fun) do
    []
  end

  def validate_schema(%SatPerms.Assign{}, _schema, _electrified) do
    {:ok, []}
  end
end

defimpl Command.PgSQL, for: SatPerms.Unassign do
  def to_sql(%SatPerms.Unassign{} = _unassign, _ddl_capture, _quote_fun) do
    []
  end

  def validate_schema(%SatPerms.Unassign{}, _schema, _electrified) do
    {:ok, []}
  end
end

defimpl Command.PgSQL, for: SatPerms.Sqlite do
  def to_sql(%SatPerms.Sqlite{} = _sqlite, _ddl_capture, _quote_fun) do
    []
  end

  def validate_schema(%SatPerms.Sqlite{}, _schema, _electrified) do
    {:ok, []}
  end
end

defimpl Command.PgSQL, for: Command.Enable do
  alias Command.Enable
  alias Electric.Postgres.Schema.Validator

  import Command.Common, only: [sql_repr: 1]

  def to_sql(%Enable{table_name: {schema, name}}, [_ | _] = ddl, quote_fun) do
    args =
      ddl
      |> Enum.map(quote_fun)
      |> Enum.join(", ")

    [
      """
      CALL electric.electrify_with_ddl(#{sql_repr(schema)}, #{sql_repr(name)}, #{args});
      """
    ]
  end

  def validate_schema(%Enable{} = enable, schema, electrified) do
    Validator.validate_schema_for_electrification(schema, enable.table_name, electrified)
  end
end

defimpl Command.PgSQL, for: Command.Disable do
  import Command.Common, only: [sql_repr: 1]

  def to_sql(%Command.Disable{} = disable, _ddl_capture, _quote_fun) do
    [
      """
      CALL electric.disable(#{sql_repr(disable.table_name)});
      """
    ]
  end

  def validate_schema(%Command.Disable{}, _schema, _electrified) do
    {:ok, []}
  end
end

defimpl Command.PgSQL, for: Command.Error do
  def to_sql(_, _, _) do
    []
  end

  def validate_schema(_, _, _) do
    {:ok, []}
  end
end
