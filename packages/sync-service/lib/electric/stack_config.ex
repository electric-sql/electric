defmodule Electric.StackConfig do
  use GenServer

  def put(stack_id, key, val) do
    :ets.insert(table(stack_id), {key, val})
  end

  def lookup(stack_id, key, default \\ nil) do
    :ets.lookup_element(table(stack_id), key, 2, default)
  end

  def lookup!(stack_id, key) do
    :ets.lookup_element(table(stack_id), key, 2)
  rescue
    ArgumentError ->
      raise RuntimeError,
        message: "stack config value #{inspect(key)} is missing for stack #{stack_id}"
  end

  @doc false
  # Should provide all required values not defined dynamically at stack init
  def default_seed_config do
    [
      snapshot_timeout_to_first_data: :timer.seconds(30),
      shape_hibernate_after: Electric.Config.default(:shape_hibernate_after),
      shape_enable_suspend?: Electric.Config.default(:shape_enable_suspend?),
      chunk_bytes_threshold: Electric.ShapeCache.LogChunker.default_chunk_size_threshold()
    ]
  end

  ###

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
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

    seed_config = Keyword.merge(default_seed_config(), Keyword.get(opts, :seed_config, []))

    tab = table(stack_id)
    :ets.new(tab, [:public, :named_table, :set, read_concurrency: true])
    :ets.insert(tab, seed_config)

    {:ok, nil}
  end
end
