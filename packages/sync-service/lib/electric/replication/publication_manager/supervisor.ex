defmodule Electric.Replication.PublicationManager.Supervisor do
  @moduledoc """
  Supervisor for the PublicationManager components.

  The strategy is `:one_for_one`, supervising the `RelationTracker` and
  `Configurator` processes.

  The `Configurator` process always starts after the `RelationTracker` process, and
  as part of its initialization it fetches the current set of shape filters. This makes
  the system resilient to `Configurator` restarts as it will always be eager to
  commit any outstanding filters to the publication.

  The `RelationTracker` process does not depend on the `Configurator` process being
  alive to function correctly, as it only tracks the shapes and their filters, and
  notifies the `Configurator` of any changes. The system is resilient to `RelationTracker`
  restarts as it repopulates its filters from the in-memory shape status cache, and
  can handle notifications for filters it is not tracking.
  """

  use Supervisor
  alias Electric.Replication.PublicationManager

  # The default debounce timeout is 0, which means that the publication update
  # will be scheduled immediately to run at the end of the current process
  # mailbox, but we are leaving this configurable in case we want larger
  # windows to aggregate shape filter updates
  @default_debounce_timeout 0

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
            refresh_period: [type: :pos_integer, required: false, default: 60_000]
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

  @impl Supervisor
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    Process.set_label({:publication_manager_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    children = [
      {PublicationManager.RelationTracker, opts},
      {PublicationManager.Configurator, opts}
    ]

    # TEMPORARY DEBUG: Insert sentinels between each child
    children = Electric.Debug.ShutdownTimer.insert_sentinels(children, "PublicationManager.Supervisor")

    Supervisor.init(children, strategy: :one_for_one)
  end
end
