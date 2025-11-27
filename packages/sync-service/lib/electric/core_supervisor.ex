defmodule Electric.CoreSupervisor do
  @moduledoc """
  A supervisor that starts the core components of the Electric system.
  This is divided into two subsystems:
  1. The connection subsystem (processes that may exit on a connection failure), started with Connection.Supervisor
  2. The shape subsystem (processes that are resilient to connection failures), started with Shapes.Supervisor
  """

  use Supervisor, restart: :transient, significant: true

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
  end

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: name(opts))
  end

  @impl true
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    Process.set_label({:core_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    connection_manager_opts = Keyword.fetch!(opts, :connection_manager_opts)

    children = [
      {Electric.Connection.Supervisor, connection_manager_opts}
    ]

    Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end

  @doc """
  This function is supposed to be called from Connection.Manager at the right point in its
  initialization sequence.
  """
  def start_shapes_supervisor(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    shape_cache_opts = Keyword.fetch!(opts, :shape_cache_opts)
    replication_opts = Keyword.fetch!(opts, :replication_opts)
    tweaks = Keyword.fetch!(opts, :tweaks)

    shape_cache_spec = {Electric.ShapeCache, shape_cache_opts}

    publication_manager_spec =
      {Electric.Replication.PublicationManager,
       stack_id: stack_id,
       publication_name: Keyword.fetch!(replication_opts, :publication_name),
       manual_table_publishing?: Keyword.fetch!(opts, :manual_table_publishing?),
       db_pool: Electric.Connection.Manager.admin_pool(stack_id),
       update_debounce_timeout: Keyword.get(tweaks, :publication_alter_debounce_ms, 0),
       refresh_period: Keyword.get(tweaks, :publication_refresh_period, 60_000)}

    child_spec =
      Supervisor.child_spec(
        {
          Electric.Shapes.Supervisor,
          stack_id: stack_id,
          shape_cache: shape_cache_spec,
          publication_manager: publication_manager_spec
        },
        restart: :transient
      )

    Supervisor.start_child(name(opts), child_spec)
  end

  @doc """
  Stops the Shapes.Supervisor if it's currently running.

  This is useful when you need to reset storage before starting a new supervisor.
  Returns :ok if the supervisor was stopped or wasn't running.
  """
  def stop_shapes_supervisor(opts) do
    case Supervisor.terminate_child(name(opts), Electric.Shapes.Supervisor) do
      :ok ->
        Supervisor.delete_child(name(opts), Electric.Shapes.Supervisor)
        :ok

      {:error, :not_found} ->
        :ok

      {:error, reason} ->
        {:error, reason}
    end
  end
end
