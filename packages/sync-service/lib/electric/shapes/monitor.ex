defmodule Electric.Shapes.Monitor do
  use Supervisor

  alias __MODULE__.MonitorRegistry

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            storage: [type: :mod_arg, required: true],
            shape_status: [type: :mod_arg, required: true],
            publication_manager: [type: :mod_arg, required: true],
            on_remove: [type: {:or, [nil, {:fun, 2}]}],
            on_cleanup: [type: {:or, [nil, {:fun, 1}]}]
          )

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(args) do
    with {:ok, config} <- NimbleOptions.validate(Map.new(args), @schema) do
      Supervisor.start_link(__MODULE__, config, name: name(config.stack_id))
    end
  end

  def register_reader(stack_id, shape_handle, pid \\ self()) do
    MonitorRegistry.register_reader(stack_id, shape_handle, pid)
  end

  def unregister_reader(stack_id, shape_handle, pid \\ self()) do
    MonitorRegistry.unregister_reader(stack_id, shape_handle, pid)
  end

  def register_writer(stack_id, shape_handle, shape, pid \\ self()) do
    MonitorRegistry.register_writer(stack_id, shape_handle, shape, pid)
  end

  def reader_count(stack_id, shape_handle) do
    MonitorRegistry.reader_count(stack_id, shape_handle)
  end

  def reader_count(stack_id) do
    MonitorRegistry.reader_count(stack_id)
  end

  def notify_reader_termination(stack_id, shape_handle, reason, pid \\ self()) do
    MonitorRegistry.notify_reader_termination(stack_id, shape_handle, reason, pid)
  end

  def termination_watchers(stack_id, shape_handle) do
    MonitorRegistry.termination_watchers(stack_id, shape_handle)
  end

  def init(opts) do
    %{
      stack_id: stack_id,
      storage: storage,
      publication_manager: publication_manager,
      shape_status: shape_status
    } = opts

    children = [
      {__MODULE__.CleanupTaskSupervisor, stack_id: stack_id},
      {__MODULE__.MonitorRegistry,
       stack_id: stack_id,
       storage: storage,
       publication_manager: publication_manager,
       shape_status: shape_status,
       on_remove: Map.get(opts, :on_remove),
       on_cleanup: Map.get(opts, :on_cleanup)}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
