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
            registry: [type: :atom, required: true],
            shape_status: [type: :mod_arg, required: true],
            storage: [type: :mod_arg, required: true],
            publication_manager: [type: :mod_arg, required: true],
            chunk_bytes_threshold: [type: :non_neg_integer, required: true],
            run_with_conn_fn: [type: {:fun, 2}, default: &DBConnection.run/2],
            db_pool: [type: {:or, [:atom, :pid, @name_schema_tuple]}, required: true],
            create_snapshot_fn: [
              type: {:fun, 7},
              default: &Electric.Shapes.Consumer.Snapshotter.query_in_readonly_txn/7
            ],
            otel_ctx: [type: :any, required: false]
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

  def whereis(stack_id, shape_handle) do
    GenServer.whereis(name(stack_id, shape_handle))
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      config = Map.new(opts)
      Supervisor.start_link(__MODULE__, config, name: name(config))
    end
  end

  def stop_and_clean(%{
        stack_id: stack_id,
        shape_handle: shape_handle
      }) do
    stop_and_clean(stack_id, shape_handle)
  end

  def stop_and_clean(stack_id, shape_handle) do
    # if consumer is present, terminate it gracefully, otherwise terminate supervisor
    consumer = Electric.Shapes.Consumer.name(stack_id, shape_handle)

    case GenServer.whereis(consumer) do
      nil ->
        try do
          Supervisor.stop(name(stack_id, shape_handle))

          :noproc
        catch
          :exit, {:noproc, _} -> :noproc
        end

      consumer_pid when is_pid(consumer_pid) ->
        GenServer.call(consumer_pid, :stop_and_clean, 30_000)
    end
  end

  def init(config) when is_map(config) do
    %{shape_handle: shape_handle, storage: {_, _} = storage} = config

    Process.set_label({:consumer_supervisor, shape_handle})
    metadata = [stack_id: config.stack_id, shape_handle: shape_handle]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

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
