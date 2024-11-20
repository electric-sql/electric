defmodule Electric.Shapes.ConsumerSupervisor do
  use Supervisor, restart: :transient

  require Logger

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @genserver_name_schema {:or, [:atom, @name_schema_tuple]}
  # TODO: unify these with ShapeCache
  @schema NimbleOptions.new!(
            stack_id: [type: :any, required: true],
            shape_handle: [type: :string, required: true],
            shape: [type: {:struct, Electric.Shapes.Shape}, required: true],
            inspector: [type: :mod_arg, required: true],
            log_producer: [type: @genserver_name_schema, required: true],
            shape_cache: [type: :mod_arg, required: true],
            registry: [type: :atom, required: true],
            shape_status: [type: :mod_arg, required: true],
            storage: [type: :mod_arg, required: true],
            chunk_bytes_threshold: [type: :non_neg_integer, required: true],
            run_with_conn_fn: [type: {:fun, 2}, default: &DBConnection.run/2],
            db_pool: [type: {:or, [:atom, :pid, @name_schema_tuple]}, required: true],
            prepare_tables_fn: [type: {:or, [:mfa, {:fun, 2}]}, required: true],
            create_snapshot_fn: [
              type: {:fun, 5},
              default: &Electric.Shapes.Consumer.Snapshotter.query_in_readonly_txn/5
            ]
          )

  def name(stack_id, shape_handle) when is_binary(shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  def name(%{
        stack_id: stack_id,
        shape_handle: shape_handle
      }) do
    name(stack_id, shape_handle)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      config = Map.new(opts)
      Supervisor.start_link(__MODULE__, config, name: name(config))
    end
  end

  def clean_and_stop(%{
        stack_id: stack_id,
        shape_handle: shape_handle
      }) do
    # if consumer is present, terminate it gracefully, otherwise terminate supervisor
    consumer = Electric.Shapes.Consumer.name(stack_id, shape_handle)

    case GenServer.whereis(consumer) do
      nil -> Supervisor.stop(name(stack_id, shape_handle))
      consumer_pid when is_pid(consumer_pid) -> GenServer.call(consumer_pid, :clean_and_stop)
    end
  end

  def init(config) when is_map(config) do
    %{shape_handle: shape_handle, storage: {_, _} = storage} =
      config

    Process.set_label({:consumer_supervisor, shape_handle})

    shape_storage = Electric.ShapeCache.Storage.for_shape(shape_handle, storage)

    shape_config = %{config | storage: shape_storage}

    children = [
      {Electric.ShapeCache.Storage, shape_storage},
      {Electric.Shapes.Consumer, shape_config},
      {Electric.Shapes.Consumer.Snapshotter, shape_config}
    ]

    Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end
end
