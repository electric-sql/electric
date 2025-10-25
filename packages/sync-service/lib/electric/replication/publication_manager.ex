defmodule Electric.Replication.PublicationManager do
  use Supervisor

  @callback name(binary() | Keyword.t()) :: term()
  @callback add_shape(shape_handle(), Electric.Shapes.Shape.t(), Keyword.t()) :: :ok
  @callback remove_shape(shape_handle(), Keyword.t()) :: :ok
  @callback wait_for_restore(Keyword.t()) :: :ok

  alias __MODULE__.RelationTracker
  @behaviour __MODULE__

  @type stack_id :: Electric.stack_id()
  @type shape_handle :: Electric.ShapeCache.shape_handle()

  # The default debounce timeout is 0, which means that the publication update
  # will be scheduled immediately to run at the end of the current process
  # mailbox, but we are leaving this configurable in case we want larger
  # windows to aggregate shape filter updates
  @default_debounce_timeout 0

  @default_restore_retry_timeout 1_000

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @genserver_name_schema {:or, [:atom, @name_schema_tuple]}
  @schema NimbleOptions.new!(
            name: [type: @genserver_name_schema, required: false],
            stack_id: [type: :string, required: true],
            publication_name: [type: :string, required: true],
            db_pool: [type: {:or, [:atom, :pid, @name_schema_tuple]}],
            manual_table_publishing?: [type: :boolean, required: false, default: false],
            update_debounce_timeout: [type: :timeout, default: @default_debounce_timeout],
            server: [type: :any, required: false],
            refresh_period: [type: :pos_integer, required: false, default: 60_000],
            restore_retry_timeout: [
              type: :pos_integer,
              required: false,
              default: @default_restore_retry_timeout
            ]
          )

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      stack_id = Keyword.fetch!(opts, :stack_id)
      Supervisor.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, name(stack_id)))
    end
  end

  defdelegate add_shape(stack_id, shape_handle, shape), to: RelationTracker

  defdelegate remove_shape(stack_id, shape_handle), to: RelationTracker

  defdelegate wait_for_restore(stack_id), to: RelationTracker

  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    Process.set_label({:publication_manager, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    children = [
      {__MODULE__.RelationTracker, opts},
      {__MODULE__.Configurator, opts}
    ]

    Supervisor.init(children, strategy: :rest_for_one)
  end
end
