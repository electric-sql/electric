defmodule Electric.Postgres.Extension.SchemaLoader do
  alias Electric.Postgres.{Schema, Extension.Migration}
  alias Electric.Replication.Connectors

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
  @type table_id() :: %{name: name(), schema: schema(), oid: oid()}

  @callback connect(Connectors.config(), Keyword.t()) :: {:ok, state()}
  @callback load(state()) :: {:ok, version(), Schema.t()}
  @callback load(state(), version()) :: {:ok, version(), Schema.t()} | {:error, binary()}
  @callback save(state(), version(), Schema.t(), [String.t()]) :: {:ok, state()}
  @callback relation_oid(state(), rel_type(), schema(), name()) :: oid_result()
  @callback primary_keys(state(), schema(), name()) :: pk_result()
  @callback primary_keys(state(), relation()) :: pk_result()
  @callback refresh_subscription(state(), name()) :: :ok | {:error, term()}
  @callback migration_history(state(), version() | nil) ::
              {:ok, [Migration.t()]} | {:error, term()}
  @callback known_migration_version?(state(), version()) :: boolean
  @callback electrified_tables(state()) :: {:ok, [table_id()]} | {:error, term()}

  @default_backend {__MODULE__.Epgsql, []}

  # set to true to trace all cache calls, useful for discovering race
  # conditions and deadlocks
  @trace_calls false

  if @trace_calls do
    defp log_trace(module, fun, state, args) do
      IO.puts(
        IO.ANSI.format([
          :reverse,
          "SchemaLoader",
          :reset,
          ": #{module}.#{fun} #{inspect(state)}, #{inspect(args)}"
        ])
      )
    end
  end

  defmacrop trace(module, fun, state, args \\ []) do
    if @trace_calls do
      quote do
        log_trace(unquote(module), unquote(fun), unquote(state), unquote(args))
      end
    end
  end

  def get(opts, key, default \\ @default_backend) do
    case Keyword.get(opts, key, default) do
      module when is_atom(module) ->
        {module, []}

      {module, opts} when is_atom(module) and is_list(opts) ->
        {module, opts}
    end
  end

  def connect({module, opts}, conn_config) do
    trace(module, :connect, [conn_config, opts])

    with {:ok, state} <- module.connect(conn_config, opts) do
      {:ok, {module, state}}
    end
  end

  def load({module, state}) do
    trace(module, :load, state)
    module.load(state)
  end

  def load({module, state}, version) do
    trace(module, :load, state, [version])
    module.load(state, version)
  end

  def save({module, state}, version, schema, stmts) do
    trace(module, :save, state, [version, schema, stmts])

    with {:ok, state} <- module.save(state, version, schema, stmts) do
      {:ok, {module, state}}
    end
  end

  def relation_oid({module, state}, rel_type, schema, table) do
    trace(module, :relation_oid, state, [rel_type, schema, table])
    module.relation_oid(state, rel_type, schema, table)
  end

  def primary_keys({module, state}, schema, table) do
    trace(module, :primary_keys, state, [schema, table])
    module.primary_keys(state, schema, table)
  end

  def primary_keys({_module, _state} = impl, {schema, table}) do
    primary_keys(impl, schema, table)
  end

  def refresh_subscription({module, state}, name) do
    trace(module, :refresh_subscription, state, [name])
    module.refresh_subscription(state, name)
  end

  def migration_history({module, state}, version) do
    trace(module, :migration_history, state, [version])
    module.migration_history(state, version)
  end

  def known_migration_version?({module, state}, version) do
    trace(module, :known_migration_version?, state, [version])
    module.known_migration_version?(state, version)
  end

  def electrified_tables({module, state}) do
    trace(module, :electrified_tables, state)
    module.electrified_tables(state)
  end
end
