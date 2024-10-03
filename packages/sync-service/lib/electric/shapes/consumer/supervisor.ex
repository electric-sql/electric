defmodule Electric.Shapes.Consumer.Supervisor do
  use Supervisor, restart: :transient

  require Logger

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @genserver_name_schema {:or, [:atom, @name_schema_tuple]}
  # TODO: unify these with ShapeCache
  @schema NimbleOptions.new!(
            shape_id: [type: :string, required: true],
            shape: [type: {:struct, Electric.Shapes.Shape}, required: true],
            electric_instance_id: [type: :atom, required: true],
            tenant_id: [type: :string, required: true],
            log_producer: [type: @genserver_name_schema, required: true],
            shape_cache: [type: :mod_arg, required: true],
            registry: [type: :atom, required: true],
            storage: [type: :mod_arg, required: true],
            chunk_bytes_threshold: [type: :non_neg_integer, required: true],
            db_pool: [type: {:or, [:atom, :pid, @name_schema_tuple]}, required: true],
            prepare_tables_fn: [type: {:or, [:mfa, {:fun, 2}]}, required: true],
            create_snapshot_fn: [
              type: {:fun, 5},
              default: &Electric.Shapes.Consumer.Snapshotter.query_in_readonly_txn/5
            ]
          )

  def name(electric_instance_id, tenant_id, shape_id) when is_binary(shape_id) do
    Electric.Application.process_name(electric_instance_id, tenant_id, __MODULE__, shape_id)
  end

  def name(%{electric_instance_id: electric_instance_id, tenant_id: tenant_id, shape_id: shape_id}) do
    name(electric_instance_id, tenant_id, shape_id)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      config = Map.new(opts)
      Supervisor.start_link(__MODULE__, config, name: name(config))
    end
  end

  def init(config) when is_map(config) do
    %{shape_id: shape_id, tenant_id: tenant_id, storage: {_, _} = storage} =
      config

    shape_storage = Electric.ShapeCache.Storage.for_shape(shape_id, tenant_id, storage)

    shape_config = %{config | storage: shape_storage}

    children = [
      {Electric.ShapeCache.Storage, shape_storage},
      {Electric.Shapes.Consumer, shape_config},
      {Electric.Shapes.Consumer.Snapshotter, shape_config}
    ]

    Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end
end
