defmodule Electric.Shapes.ConsumerSupervisor do
  use Supervisor, restart: :transient

  require Logger

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  # TODO: unify these with ShapeCache
  @schema NimbleOptions.new!(
            stack_id: [type: :any, required: true],
            shape_handle: [type: :string, required: true],
            shape: [type: {:struct, Electric.Shapes.Shape}, required: true],
            inspector: [type: :mod_arg, required: true],
            registry: [type: :atom, required: true],
            shape_status: [type: :mod_arg, required: true],
            storage: [type: :mod_arg, required: true],
            publication_manager: [type: :mod_arg, required: true],
            chunk_bytes_threshold: [type: :non_neg_integer, required: true],
            db_pool: [type: {:or, [:atom, :pid, @name_schema_tuple]}, required: true],
            snapshot_timeout_to_first_data: [
              type: {:or, [:non_neg_integer, {:in, [:infinity]}]},
              default: :timer.seconds(30)
            ],
            hibernate_after: [type: :integer, required: true],
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

  def start_materializer(opts) do
    Supervisor.start_child(name(opts), {Electric.Shapes.Consumer.Materializer, opts})
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
      {Electric.Shapes.Consumer.Snapshotter,
       %{
         chunk_bytes_threshold: config.chunk_bytes_threshold,
         db_pool: config.db_pool,
         otel_ctx: Map.get(config, :otel_ctx),
         publication_manager: config.publication_manager,
         shape: config.shape,
         shape_handle: shape_handle,
         snapshot_timeout_to_first_data: config.snapshot_timeout_to_first_data,
         stack_id: config.stack_id,
         storage: shape_storage
       }},
      {Electric.Shapes.Consumer, shape_config}
    ]

    Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end
end
