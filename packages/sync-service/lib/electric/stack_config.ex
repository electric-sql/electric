defmodule Electric.StackConfig do
  use GenServer

  def put(stack_id, key, val) do
    :ets.insert(table(stack_id), {key, val})
  end

  def fetch!(stack_id, key) do
    :ets.lookup_element(table(stack_id), key, 2)
  end

  def get(stack_id, key) do
    :ets.lookup_element(table(stack_id), key, 2, nil)
  end

  ###

  def name(opts) when is_list(opts), do: name(Keyword.fetch!(opts, :stack_id))

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def table(stack_id) do
    :"#{inspect(__MODULE__)}:#{stack_id}"
  end

  ###

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: name(opts))
  end

  @impl GenServer
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    tab = table(stack_id)
    :ets.new(tab, [:public, :named_table, :set, read_concurrency: true])

    {:ok, nil}
  end
end
