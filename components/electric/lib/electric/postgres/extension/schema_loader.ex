defmodule Electric.Postgres.Extension.SchemaLoader do
  alias Electric.Postgres.Schema
  alias Electric.Replication.Connectors

  @type state() :: term()
  @type version() :: binary()

  @callback connect(Connectors.config(), Keyword.t()) :: {:ok, state()}
  @callback load(state()) :: {:ok, version(), Schema.t()}
  @callback load(state(), version()) :: {:ok, version(), Schema.t()} | {:error, binary()}
  @callback save(state(), version(), Schema.t()) :: {:ok, state()}

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
end

defmodule Electric.Postgres.Extension.SchemaLoader.Epgsql do
  alias Electric.Postgres.Extension
  alias Electric.Replication.Connectors

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
end
