defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.Statistics do
  @moduledoc """
  Keeps track of the number of active SQLite connections using an
  `:atomics`-based counter.
  """

  use GenServer

  require Logger

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
  end

  def start_link(args) do
    GenServer.start_link(__MODULE__, args, name: name(args))
  end

  def current(stack_id) do
    GenServer.call(name(stack_id), :current)
  end

  def worker_start(opts) do
    opts
    |> Keyword.fetch!(:connection_count)
    |> :atomics.add(1, 1)
  end

  def worker_stop(opts) do
    opts
    |> Keyword.fetch!(:connection_count)
    |> :atomics.sub(1, 1)
  end

  @impl GenServer
  def init(args) do
    stack_id = Keyword.fetch!(args, :stack_id)
    connections = Keyword.fetch!(args, :connection_count)

    Process.set_label({:shape_db_statistics, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    {:ok, %{stack_id: stack_id, connections: connections}, :hibernate}
  end

  @impl GenServer
  def handle_call(:current, _from, %{connections: connections} = state) do
    {:reply, {:ok, %{connections: :atomics.get(connections, 1)}}, state}
  end

  @impl GenServer
  def handle_info(msg, state) do
    Logger.warning("#{__MODULE__} Received unexpected message #{inspect(msg)}")
    {:noreply, state}
  end
end
