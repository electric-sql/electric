defmodule Electric.Application.Configuration do
  @moduledoc """
  A simple interface to `:persistent_term` that is designed for storing and retrieving the
  global application configuration (stored as a single map).
  """

  defstruct ~w[
    electric_instance_id
    storage
    persistent_kv
    connection_opts
    replication_opts
    pool_opts
    inspector
    shape_cache_opts
  ]a

  @type t :: %__MODULE__{}

  @persistent_key __MODULE__

  # This function is called once in the application's start() callback. It reads configuration
  # from the OTP application env, runs some pre-processing functions and stores the processed
  # configuration as a single map using `:persistent_term`.
  @spec load() :: t()
  def load do
    try do
      # Make sure the application configuration is only stored once.
      _config = :persistent_term.get(@persistent_key)
    rescue
      ArgumentError ->
        build() |> save()
    end
  end

  defp build do
    electric_instance_id = Application.get_env(:electric, :electric_instance_id, :default)

    {storage_module, storage_in_opts} =
      Application.get_env(:electric, :storage, default_storage(electric_instance_id))

    storage_opts = storage_module.shared_opts(storage_in_opts)
    storage = {storage_module, storage_opts}

    {kv_module, kv_fun, kv_params} =
      Application.get_env(:electric, :persistent_kv, default_persistent_kv())

    persistent_kv = apply(kv_module, kv_fun, [kv_params])

    replication_stream_id = Application.get_env(:electric, :replication_stream_id, "default")
    publication_name = "electric_publication_#{replication_stream_id}"
    slot_name = "electric_slot_#{replication_stream_id}"
    slot_temporary? = Application.get_env(:electric, :replication_slot_temporary?, false)

    get_pg_version_fn = fn ->
      Electric.Connection.Manager.get_pg_version(Electric.Connection.Manager)
    end

    prepare_tables_mfa =
      {Electric.Postgres.Configuration, :configure_tables_for_replication!,
       [get_pg_version_fn, publication_name]}

    inspector =
      {Electric.Postgres.Inspector.EtsInspector, server: Electric.Postgres.Inspector.EtsInspector}

    shape_cache_opts = [
      electric_instance_id: electric_instance_id,
      storage: storage,
      inspector: inspector,
      prepare_tables_fn: prepare_tables_mfa,
      chunk_bytes_threshold:
        Application.get_env(
          :electric,
          :chunk_bytes_threshold,
          Electric.ShapeCache.LogChunker.default_chunk_size_threshold()
        ),
      log_producer: Electric.Replication.ShapeLogCollector.name(electric_instance_id),
      consumer_supervisor: Electric.Shapes.ConsumerSupervisor.name(electric_instance_id),
      registry: Registry.ShapeChanges
    ]

    %Electric.Application.Configuration{
      electric_instance_id: electric_instance_id,
      storage: storage,
      persistent_kv: persistent_kv,
      connection_opts: connection_opts(),
      replication_opts: %{
        stream_id: replication_stream_id,
        publication_name: publication_name,
        slot_name: slot_name,
        slot_temporary?: slot_temporary?
      },
      pool_opts: %{
        size: Application.get_env(:electric, :db_pool_size, 20)
      },
      inspector: inspector,
      shape_cache_opts: shape_cache_opts
    }
  end

  defp connection_opts do
    if connection_opts = Application.get_env(:electric, :connection_opts, nil) do
      connection_opts
    else
      database_url = Dotenvy.env!("DATABASE_URL", :string)

      case Electric.ConfigParser.parse_postgresql_uri(database_url) |> dbg do
        {:ok, database_url_config} ->
          database_ipv6_config =
            Dotenvy.env!("DATABASE_USE_IPV6", :boolean, false)

          database_url_config ++ [ipv6: database_ipv6_config]

        {:error, reason} ->
          raise RuntimeError, message: "Invalid DATABASE_URL: #{reason}"
      end
    end
    |> Electric.Utils.obfuscate_password()
  end

  defp default_persistent_kv do
    {Electric.PersistentKV.Filesystem, :new!, root: storage_dir("state")}
  end

  defp default_storage(instance_id) do
    {Electric.ShapeCache.FileStorage,
     storage_dir: storage_dir("shapes"), electric_instance_id: instance_id}
  end

  defp storage_dir(sub_dir) do
    Path.join("./persistent", sub_dir)
  end

  @spec save(t()) :: t()
  defp save(config) do
    :ok = :persistent_term.put(@persistent_key, config)
    config
  end

  @spec get() :: t()
  def get, do: :persistent_term.get(@persistent_key)
end
