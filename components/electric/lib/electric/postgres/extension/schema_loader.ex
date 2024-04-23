defmodule Electric.Postgres.Extension.SchemaLoader do
  alias Electric.Postgres.{Schema, Extension.Migration}
  alias Electric.Replication.Connectors
  alias Electric.Satellite.SatPerms
  alias __MODULE__.Version

  @type state() :: term()
  @type version() :: String.t()
  @type name() :: String.t()
  @type schema() :: name()
  @type relation() :: {schema(), name()}
  @type oid() :: integer()
  @type ddl() :: String.t()
  @type rel_type() :: :table | :index | :view | :trigger
  @type oid_result() :: {:ok, integer()} | {:error, term()}
  @type pk_result() :: {:ok, [name()]} | {:error, term()}
  @type oid_loader() :: (rel_type(), schema(), name() -> oid_result())
  @type table() :: Electric.Postgres.Replication.Table.t()
  @type t() :: {module(), state()}
  @type tx_fk_row() :: %{binary() => integer() | binary()}

  @callback connect(term(), Connectors.config()) :: {:ok, state()}
  @callback load(state()) :: {:ok, Version.t()} | {:error, binary()}
  @callback load(state(), version()) :: {:ok, Version.t()} | {:error, binary()}
  @callback save(state(), version(), Schema.t(), [String.t()]) ::
              {:ok, state(), Version.t()} | {:error, term()}
  @callback relation_oid(state(), rel_type(), schema(), name()) :: oid_result()
  @callback refresh_subscription(state(), name()) :: :ok | {:error, term()}
  @callback migration_history(state(), version() | nil) ::
              {:ok, [Migration.t()]} | {:error, term()}
  @callback known_migration_version?(state(), version()) :: boolean
  @callback internal_schema(state()) :: Electric.Postgres.Schema.t()
  @callback table_electrified?(state(), relation()) :: {:ok, boolean()} | {:error, term()}
  @callback index_electrified?(state(), relation()) :: {:ok, boolean()} | {:error, term()}
  @callback tx_version(state(), tx_fk_row()) :: {:ok, version()} | {:error, term()}

  # ok, so these permissions related callbacks are definitely the last nail in the coffin of the
  # `SchemaLoader` idea.  basically we need the same kind of access to some usually pg-backed
  # permissions state data as we do to the schema state. seems pointless to duplicate the pg
  # connection stuff, plus why have two connection pools when we already have one.
  @callback global_permissions(state()) :: {:ok, %SatPerms.Rules{}} | {:error, term()}
  @callback global_permissions(state(), id :: integer()) ::
              {:ok, %SatPerms.Rules{}} | {:error, term()}
  # loading user permissions for a new user requires inserting an empty state
  @callback user_permissions(state(), user_id :: binary()) ::
              {:ok, state(), %SatPerms{}} | {:error, term()}

  @callback user_permissions(state(), user_id :: binary(), id :: integer()) ::
              {:ok, %SatPerms{}} | {:error, term()}

  @callback save_global_permissions(state(), %SatPerms.Rules{}) ::
              {:ok, state()} | {:error, term()}
  @callback save_user_permissions(state(), user_id :: binary(), %SatPerms.Roles{}) ::
              {:ok, state(), %SatPerms{}} | {:error, term()}

  @default_backend {__MODULE__.Epgsql, []}

  @behaviour __MODULE__

  def get(opts, key, default \\ @default_backend) do
    case Keyword.get(opts, key, default) do
      module when is_atom(module) ->
        {module, []}

      {module, opts} when is_atom(module) ->
        {module, opts}
    end
  end

  @impl true
  def connect({module, opts}, conn_config) do
    with {:ok, state} <- module.connect(opts, conn_config) do
      {:ok, {module, state}}
    end
  end

  @impl true
  def load({module, state}) do
    module.load(state)
  end

  @impl true
  def load({module, state}, version) do
    module.load(state, version)
  end

  @impl true
  def save({module, state}, version, schema, stmts) do
    with {:ok, state, schema_version} <- module.save(state, version, schema, stmts) do
      {:ok, {module, state}, schema_version}
    end
  end

  @impl true
  def relation_oid({module, state}, rel_type, schema, table) do
    module.relation_oid(state, rel_type, schema, table)
  end

  @impl true
  def refresh_subscription({module, state}, name) do
    module.refresh_subscription(state, name)
  end

  @impl true
  def migration_history({module, state}, version) do
    module.migration_history(state, version)
  end

  @impl true
  def known_migration_version?({module, state}, version) do
    module.known_migration_version?(state, version)
  end

  @impl true
  def internal_schema({module, state}) do
    module.internal_schema(state)
  end

  def count_electrified_tables({_module, _state} = impl) do
    with {:ok, _, schema} <- load(impl) do
      {:ok, Schema.num_electrified_tables(schema)}
    end
  end

  @impl true
  def table_electrified?({module, state}, relation) do
    module.table_electrified?(state, relation)
  end

  @impl true
  def index_electrified?({module, state}, relation) do
    module.index_electrified?(state, relation)
  end

  @impl true
  def tx_version({module, state}, row) do
    module.tx_version(state, row)
  end

  @impl true
  def global_permissions({module, state}) do
    module.global_permissions(state)
  end

  @impl true
  def global_permissions({module, state}, id) do
    module.global_permissions(state, id)
  end

  @impl true
  def save_global_permissions({module, state}, rules) do
    with {:ok, state} <- module.save_global_permissions(state, rules) do
      {:ok, {module, state}}
    end
  end

  @impl true
  def user_permissions({module, state}, user_id) do
    with {:ok, state, perms} <- module.user_permissions(state, user_id) do
      {:ok, {module, state}, perms}
    end
  end

  @impl true
  def user_permissions({module, state}, user_id, perms_id) do
    with {:ok, perms} <- module.user_permissions(state, user_id, perms_id) do
      {:ok, perms}
    end
  end

  @impl true
  def save_user_permissions({module, state}, user_id, roles) do
    with {:ok, state, perms} <- module.save_user_permissions(state, user_id, roles) do
      {:ok, {module, state}, perms}
    end
  end
end
