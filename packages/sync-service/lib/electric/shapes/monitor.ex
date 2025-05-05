defmodule Electric.Shapes.Monitor do
  use Supervisor

  alias __MODULE__.MonitorRegistry

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            storage: [type: :mod_arg, required: true],
            on_remove: [type: {:fun, 2}],
            on_cleanup: [type: {:fun, 1}]
          )

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(args) do
    with {:ok, config} <- NimbleOptions.validate(Map.new(args), @schema) do
      Supervisor.start_link(__MODULE__, config, name: name(config.stack_id))
    end
  end

  def register_subscriber(stack_id, shape_handle, pid \\ self()) do
    MonitorRegistry.register_subscriber(stack_id, shape_handle, pid)
  end

  def unregister_subscriber(stack_id, shape_handle, pid \\ self()) do
    MonitorRegistry.unregister_subscriber(stack_id, shape_handle, pid)
  end

  def register_consumer(stack_id, shape_handle, pid \\ self()) do
    MonitorRegistry.register_consumer(stack_id, shape_handle, pid)
  end

  def subscriber_count(stack_id, shape_handle) do
    MonitorRegistry.subscriber_count(stack_id, shape_handle)
  end

  def wait_subscriber_termination(stack_id, shape_handle, pid \\ self()) do
    MonitorRegistry.wait_subscriber_termination(stack_id, shape_handle, pid)
  end

  def termination_subscribers(stack_id, shape_handle) do
    MonitorRegistry.termination_subscribers(stack_id, shape_handle)
  end

  def register_cleanup(stack_id, shape_handle, wait_pid, pid \\ self()) do
    MonitorRegistry.register_cleanup(stack_id, shape_handle, wait_pid, pid)
  end

  def init(opts) do
    %{stack_id: stack_id, storage: storage} = opts

    children = [
      {__MODULE__.CleanupTaskSupervisor, stack_id: stack_id},
      {__MODULE__.MonitorRegistry,
       stack_id: stack_id,
       storage: storage,
       on_remove: Map.get(opts, :on_remove),
       on_cleanup: Map.get(opts, :on_cleanup)}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
