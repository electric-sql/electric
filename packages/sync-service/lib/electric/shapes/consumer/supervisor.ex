defmodule Electric.Shapes.Consumer.Supervisor do
  use Supervisor, restart: :transient

  require Logger

  # TODO: unify these with ShapeCache
  @schema NimbleOptions.new!(
            shape_id: [type: :string, required: true],
            shape: [type: {:struct, Electric.Shapes.Shape}, required: true],
            log_producer: [type: {:or, [:pid, :atom]}, required: true],
            shape_cache: [type: :mod_arg, required: true],
            registry: [type: :atom, required: true],
            storage: [type: :mod_arg, required: true],
            chunk_bytes_threshold: [type: :non_neg_integer, required: true],
            db_pool: [type: {:or, [:atom, :pid]}, default: Electric.DbPool],
            prepare_tables_fn: [type: {:or, [:mfa, {:fun, 2}]}, required: true],
            create_snapshot_fn: [
              type: {:fun, 5},
              default: &Electric.Shapes.Consumer.Snapshotter.query_in_readonly_txn/5
            ]
          )

  def name(shape_id) when is_binary(shape_id) do
    Electric.Application.process_name(__MODULE__, shape_id)
  end

  def name(%{shape_id: shape_id}) do
    name(shape_id)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      config = Map.new(opts)
      Supervisor.start_link(__MODULE__, config, name: name(config))
    end
  end

  def init(config) when is_map(config) do
    %{shape_id: shape_id, storage: {_, _} = storage} =
      config

    shape_storage = Electric.ShapeCache.Storage.for_shape(shape_id, storage)

    shape_config = %{config | storage: shape_storage}

    children = [
      {Electric.ShapeCache.Storage, shape_storage},
      {Electric.Shapes.Consumer, shape_config},
      {Electric.Shapes.Consumer.Snapshotter, shape_config}
    ]

    Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end
end
