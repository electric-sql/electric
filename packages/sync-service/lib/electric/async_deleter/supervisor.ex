defmodule Electric.AsyncDeleter.Supervisor do
  @moduledoc """
  A Supervisor for the Electric.AsyncDeleter components.
  """

  use Supervisor
  require Logger

  def name(stack_id) when is_binary(stack_id),
    do: Electric.ProcessRegistry.name(stack_id, __MODULE__)

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: name(Keyword.fetch!(opts, :stack_id)))
  end

  @impl true
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    Process.set_label({:async_deleter_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    children = [
      {Electric.AsyncDeleter.CleanupTaskSupervisor, stack_id: stack_id},
      {Electric.AsyncDeleter.RequestHandler, opts}
    ]

    Supervisor.init(children, strategy: :one_for_all)
  end
end
