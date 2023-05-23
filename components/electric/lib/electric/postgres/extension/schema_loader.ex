defmodule Electric.Postgres.Extension.SchemaLoader do
  alias Electric.Postgres.Schema
  alias Electric.Replication.Connectors

  @type state() :: term()
  @type version() :: binary()
  @type name() :: binary()
  @type schema() :: name()
  @type oid() :: integer()
  @type rel_type() :: :table | :index | :view | :trigger
  @type oid_result() :: {:ok, integer()} | {:error, term()}
  @type pk_result() :: {:ok, [name()]} | {:error, term()}
  @type oid_loader() :: (rel_type(), schema(), name() -> oid_result())

  @callback connect(Connectors.config(), Keyword.t()) :: {:ok, state()}
  @callback load(state()) :: {:ok, version(), Schema.t()}
  @callback load(state(), version()) :: {:ok, version(), Schema.t()} | {:error, binary()}
  @callback save(state(), version(), Schema.t()) :: {:ok, state()}
  @callback relation_oid(state(), rel_type(), schema(), name()) :: oid_result()
  @callback primary_keys(state(), schema(), name()) :: pk_result()
  @callback refresh_subscription(state(), name()) :: :ok | {:error, term()}

  @default_backend {__MODULE__.Epgsql, []}

  def get(opts, key, default \\ @default_backend) do
    case Keyword.get(opts, key, default) do
      module when is_atom(module) ->
        {module, []}

      {module, opts} when is_atom(module) and is_list(opts) ->
        {module, opts}
    end
  end

  def connect({module, opts}, conn_config) do
    with {:ok, state} <- module.connect(conn_config, opts) do
      {:ok, {module, state}}
    end
  end

  def load({module, state}) do
    module.load(state)
  end

  def load({module, state}, version) do
    module.load(state, version)
  end

  def save({module, state}, version, schema) do
    with {:ok, state} <- module.save(state, version, schema) do
      {:ok, {module, state}}
    end
  end

  def relation_oid({module, state}, rel_type, schema, table) do
    module.relation_oid(state, rel_type, schema, table)
  end

  def primary_keys({module, state}, schema, table) do
    module.primary_keys(state, schema, table)
  end

  def refresh_subscription({module, state}, name) do
    module.refresh_subscription(state, name)
  end
end

defmodule Electric.Postgres.Extension.SchemaLoader.Epgsql do
  alias Electric.Postgres.Extension
  alias Electric.Replication.Connectors

  require Logger

  @behaviour Extension.SchemaLoader

  @impl true
  def connect(conn_config, _opts) do
    conn_config
    |> Connectors.get_connection_opts(replication: false)
    |> :epgsql.connect()
  end

  @impl true
  def load(conn) do
    Extension.current_schema(conn)
  end

  @impl true
  def load(conn, version) do
    Extension.schema_version(conn, version)
  end

  @impl true
  def save(conn, version, schema) do
    with :ok <- Extension.save_schema(conn, version, schema) do
      {:ok, conn}
    end
  end

  @relkind %{table: ["r"], index: ["i"], view: ["v", "m"]}
  @pg_class_query """
  SELECT c.oid
  FROM pg_class c 
    INNER JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE
      n.nspname = $1
      AND c.relname = $2
      AND c.relkind = ANY($3::char[])
  LIMIT 1;
  """

  @impl true
  def relation_oid(_conn, :trigger, _schema, _table) do
    raise RuntimeError, message: "oid lookup for triggers no implemented"
  end

  def relation_oid(conn, rel_type, schema, table) do
    with {:ok, relkind} <- Map.fetch(@relkind, rel_type),
         {:ok, _, [{oid}]} <- :epgsql.equery(conn, @pg_class_query, [schema, table, relkind]) do
      {:ok, String.to_integer(oid)}
    end
  end

  @primary_keys_query """
  SELECT a.attname
  FROM pg_class c 
    INNER JOIN pg_namespace n ON c.relnamespace = n.oid
    INNER JOIN pg_index i ON i.indrelid = c.oid
    INNER JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE
      n.nspname = $1
      AND c.relname = $2
      AND c.relkind = 'r'
      AND i.indisprimary
  """

  @impl true
  def primary_keys(conn, schema, name) do
    {:ok, _, pks_data} = :epgsql.equery(conn, @primary_keys_query, [schema, name])

    {:ok, Enum.map(pks_data, &elem(&1, 0))}
  end

  @impl true
  def refresh_subscription(conn, name) do
    query = ~s|ALTER SUBSCRIPTION "#{name}" REFRESH PUBLICATION WITH (copy_data = false)|

    case :epgsql.squery(conn, query) do
      {:ok, [], []} ->
        :ok

      # "ALTER SUBSCRIPTION ... REFRESH is not allowed for disabled subscriptions"
      # ignore this as it's due to race conditions with the rest of the system
      {:error, {:error, :error, "55000", :object_not_in_prerequisite_state, _, _}} ->
        Logger.warn("Unable to refresh DISABLED subscription #{name}")
        :ok

      error ->
        error
    end
  end
end
