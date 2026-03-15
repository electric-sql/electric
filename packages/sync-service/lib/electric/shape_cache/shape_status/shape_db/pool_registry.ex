defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.PoolRegistry do
  @moduledoc """
  Manages pool registration for a stack. Contains the `exclusive_mode` logic,
  so that when enabled, the same write connection is returned for reads and
  writes.

  In `exclusive_mode` only the writer pool is started by the supervisor.
  """
  use GenServer

  import Electric, only: [is_stack_id: 1]

  def start_link(args) do
    GenServer.start_link(__MODULE__, args)
  end

  @doc """
  Used by pool processes for registration. The `exclusive?` boolean is passed
  onto the `register_name/2` call and determines whether the connection is
  registered for both reads and writes in `exclusive_mode`.
  """
  def pool_name(stack_id, role, exclusive?)
      when is_stack_id(stack_id) and role in [:read, :write] do
    {:via, __MODULE__, {stack_id, role, exclusive?}}
  end

  @doc """
  Used by ShapeDb to retrieve a pool.
  """
  def pool_name(stack_id, role) when is_stack_id(stack_id) and role in [:read, :write] do
    {:via, __MODULE__, {stack_id, role}}
  end

  # GenServer name registration callback
  def register_name({stack_id, role, exclusive?}, pid) when is_stack_id(stack_id) do
    keys = pool_keys(role, exclusive?, pid)
    if :ets.insert_new(ets_table(stack_id), keys), do: :yes, else: :no
  end

  # GenServer name registration callback
  def unregister_name({stack_id, role, exclusive?}) do
    table = ets_table(stack_id)

    pool_keys(role, exclusive?)
    |> Enum.each(&:ets.delete(table, &1))
  end

  # GenServer name registration callback
  def whereis_name({stack_id, role}) do
    :ets.lookup_element(ets_table(stack_id), role, 2, nil) || :undefined
  end

  # GenServer name registration callback
  def whereis_name({stack_id, :write, true}) do
    :ets.lookup_element(ets_table(stack_id), :write, 2, nil) || :undefined
  end

  def whereis_name({stack_id, role, false}) do
    :ets.lookup_element(ets_table(stack_id), role, 2, nil) || :undefined
  end

  defp pool_keys(:write, true, pid) do
    [{:read, pid}, {:write, pid}]
  end

  defp pool_keys(role, false, pid) do
    [{role, pid}]
  end

  # used by unregister_name/1
  defp pool_keys(:write, true) do
    [:read, :write]
  end

  defp pool_keys(role, false) do
    [role]
  end

  @impl GenServer
  def init(args) do
    stack_id = Keyword.fetch!(args, :stack_id)

    Process.set_label({:shape_db_pool_registry, stack_id})
    Logger.metadata(stack_id: stack_id)

    table =
      :ets.new(ets_table(stack_id), [
        :public,
        :named_table,
        read_concurrency: true,
        write_concurrency: :auto
      ])

    {:ok, %{table: table, stack_id: stack_id}}
  end

  defp ets_table(stack_id),
    do: :"Electric.ShapeCache.ShapeStatus.ShapeDb.PoolRegistry:#{stack_id}"
end
