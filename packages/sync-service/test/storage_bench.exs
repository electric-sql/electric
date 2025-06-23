alias Electric.Replication.Changes
alias Electric.Replication.LogOffset
alias Electric.Replication.Changes.NewRecord
alias Electric.ShapeCache.Storage
alias Electric.Utils

stack_id = "test-stack"
base_dir = System.get_env("BENCH_DIR", "tmp/bench")
Electric.ProcessRegistry.start_link(stack_id: stack_id)

file_storage =
  {Electric.ShapeCache.FileStorage,
   Electric.ShapeCache.FileStorage.shared_opts(
     storage_dir: "#{base_dir}/file_storage",
     stack_id: "test-stack"
   )}

pure_file_storage =
  {Electric.ShapeCache.PureFileStorage,
   Electric.ShapeCache.PureFileStorage.shared_opts(
     storage_dir: "#{base_dir}/pure_file_storage",
     stack_id: "test-stack",
     chunk_bytes_threshold: 10 * 1024 * 1024
   )}

changes_prep = fn changes ->
  changes
  |> Enum.map(&Changes.fill_key(&1, ["id"]))
  |> Enum.flat_map(&Electric.LogItems.from_change(&1, 1, ["id"], :default))
  |> Enum.map(fn {offset, log_item} ->
    {offset, log_item.key, log_item.headers.operation, Jason.encode!(log_item)}
  end)
end

inputs = %{
  "Small transaction (1 op)" =>
    [
      %NewRecord{
        relation: {"public", "test"},
        record: %{"id" => Utils.uuid4()},
        log_offset: LogOffset.new(1, 1)
      }
    ]
    |> then(changes_prep),
  "Medium transaction (20 ops)" =>
    Enum.map(1..20, fn i ->
      %NewRecord{
        relation: {"public", "test"},
        record: %{"id" => Utils.uuid4()},
        log_offset: LogOffset.new(1, i)
      }
    end)
    |> then(changes_prep),
  "Large transaction (1000 ops)" =>
    Enum.map(1..1000, fn i ->
      %NewRecord{
        relation: {"public", "test"},
        record: %{"id" => Utils.uuid4()},
        log_offset: LogOffset.new(1, i)
      }
    end)
    |> then(changes_prep)
}

defmodule FakeConsumer do
  alias Electric.ShapeCache.Storage
  use GenServer, restart: :temporary

  def start_link([_storage, _shape_def] = opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  def store_changes(server, txn) do
    GenServer.call(server, {:store_changes, txn})
  end

  def init([storage, shape_def]) do
    Process.flag(:trap_exit, true)
    {:ok, Storage.init_writer!(storage, shape_def)}
  end

  def handle_call({:store_changes, txn}, _from, storage) do
    {:reply, :ok, Storage.append_to_log!(txn, storage)}
  end

  def handle_info({:EXIT, _, reason}, state) do
    {:stop, :normal, state}
  end

  def handle_info({Storage, message}, state) do
    {:noreply, Storage.apply_message(state, message)}
  end

  def terminate(_, storage) do
    Storage.terminate(storage)
  end
end

shape = %Electric.Shapes.Shape{
  root_table_id: 1,
  root_pk: ["id"],
  root_table: {"public", "test"},
  root_column_count: 1,
  selected_columns: ["id"],
  where: nil
}

setup_storage = fn folder, storage, init_fn ->
  fn input ->
    File.rm_rf!(folder)

    {:ok, root_supervisor} = Supervisor.start_link([], strategy: :one_for_one)

    {:ok, stack_pid} =
      Supervisor.start_child(
        root_supervisor,
        Supervisor.child_spec(Storage.stack_child_spec(storage), restart: :temporary)
      )

    shape_opts = Storage.for_shape("test-shape-1", storage)
    {:ok, pid} = Supervisor.start_child(root_supervisor, Storage.child_spec(shape_opts))

    {:ok, consumer_pid} =
      Supervisor.start_child(root_supervisor, {FakeConsumer, [shape_opts, shape]})

    Storage.mark_snapshot_as_started(shape_opts)
    Storage.make_new_snapshot!([], shape_opts)

    init_fn.(
      {input,
       %{
         pid: pid,
         storage: shape_opts,
         base_storage: storage,
         consumer_pid: consumer_pid,
         root_supervisor: root_supervisor
       }}
    )
  end
end

teardown_storage = fn {_,
                       %{
                         pid: pid,
                         storage: storage,
                         consumer_pid: consumer_pid,
                         root_supervisor: root_supervisor
                       }} ->
  Process.sleep(1000)

  Supervisor.stop(root_supervisor)

  Storage.cleanup!(storage)
end

test_appends = fn {input, %{consumer_pid: consumer_pid}} = context ->
  FakeConsumer.store_changes(consumer_pid, input)
  context
end

# Test 1 - writes to single shape
Benchee.init(
  time: 10,
  inputs: inputs,
  before_each: fn {input, context} ->
    timestamp = System.monotonic_time() + System.os_time()

    input =
      Enum.map(input, fn {%LogOffset{op_offset: op_offset}, key, type, json} ->
        {LogOffset.new(timestamp, op_offset), key, type, json}
      end)

    {input, context}
  end,
  after_each: fn {input, %{storage: storage}} ->
    nil
    {%LogOffset{tx_offset: tx_offset}, _, _, _} = List.first(input)
    {last_offset, _, _, _} = List.last(input)

    total_read_back =
      Storage.get_log_stream(LogOffset.new(tx_offset - 1, 0), last_offset, storage)
      |> Enum.reduce(0, fn _, acc -> acc + 1 end)

    if total_read_back != length(input) do
      import IEx
      IEx.pry()
      raise "Total read back #{total_read_back} does not match input length #{length(input)}"
    end
  end
)
|> Benchee.system()
|> Benchee.benchmark("FileStorage", {
  test_appends,
  before_scenario: setup_storage.("#{base_dir}/file_storage", file_storage, & &1),
  after_scenario: teardown_storage
})
|> Benchee.benchmark("PureFileStorage", {
  test_appends,
  before_scenario: setup_storage.("#{base_dir}/pure_file_storage", pure_file_storage, & &1),
  after_scenario: teardown_storage
})
|> Benchee.collect()
|> Benchee.statistics()
|> Benchee.load()
|> Benchee.relative_statistics()
|> Benchee.Formatter.output(Benchee.Formatters.Console)

# # Test 2 - chunk-aligned reads from random points

inputs = %{
  "5 chunks" => 5,
  "10 chunks" => 10
}

write_n_chunks = fn n, %{consumer_pid: consumer_pid} ->
  # One item here is appx 270 bytes, so for ~10MB chunks we need ~39k items

  start_time = System.monotonic_time(:millisecond)

  Stream.from_index(
    &%NewRecord{
      relation: {"public", "test"},
      record: %{
        "id" => Utils.uuid4(),
        "value" => to_string(&1),
        "timestamp" => to_string(System.monotonic_time())
      },
      log_offset: LogOffset.new(&1, 0)
    }
  )
  |> Stream.map(&Changes.fill_key(&1, ["id"]))
  |> Stream.flat_map(&Electric.LogItems.from_change(&1, 1, ["id"], :default))
  |> Stream.map(fn {offset, log_item} ->
    {offset, log_item.key, log_item.headers.operation, Jason.encode!(log_item)}
  end)
  |> Stream.take(n * 39000)
  |> Stream.chunk_every(500)
  |> Enum.each(&FakeConsumer.store_changes(consumer_pid, &1))

  IO.puts("Written #{n} chunks in #{System.monotonic_time(:millisecond) - start_time}ms")

  1..(39000 * n)
end

setup_write_n_chunks =
  fn {n, ctx} -> {write_n_chunks.(n, ctx), ctx} end

read_chunk = fn {input, %{storage: storage}} ->
  boundary = Storage.get_chunk_end_log_offset(input, storage) || LogOffset.last()

  Storage.get_log_stream(input, boundary, storage)
  |> Enum.reduce(0, fn _, acc -> acc + 1 end)

  # |> IO.inspect(label: "read_chunk")
end

Benchee.init(
  time: 5,
  inputs: inputs,
  before_each: fn {range, context} ->
    {LogOffset.new(Enum.random(range), 0), context}
  end
)
|> Benchee.system()
|> Benchee.benchmark("FileStorage", {
  read_chunk,
  before_scenario: setup_storage.("#{base_dir}/file_storage", file_storage, setup_write_n_chunks),
  after_scenario: teardown_storage
})
|> Benchee.benchmark("PureFileStorage", {
  read_chunk,
  before_scenario:
    setup_storage.("#{base_dir}/pure_file_storage", pure_file_storage, setup_write_n_chunks),
  after_scenario: teardown_storage
})
|> Benchee.collect()
|> Benchee.statistics()
|> Benchee.load()
|> Benchee.relative_statistics()
|> Benchee.Formatter.output(Benchee.Formatters.Console)

# # Test 3 - High concurrency reads from same shape

read_n_chunks_in_parallel = fn {inputs, %{base_storage: base_storage}} ->
  Task.async_stream(
    inputs,
    fn input ->
      storage = Storage.for_shape("test-shape-1", base_storage)

      read_chunk.({input, %{storage: storage}})
    end,
    max_concurrency: 200,
    ordered: false,
    timeout: :infinity
  )
  |> Stream.run()
end

Benchee.init(
  time: 5,
  inputs: inputs,
  before_each: fn {range, context} ->
    offsets = Enum.map(1..200, fn _ -> LogOffset.new(Enum.random(range), 0) end)

    {offsets, context}
  end
)
|> Benchee.system()
|> Benchee.benchmark("FileStorage", {
  read_n_chunks_in_parallel,
  before_scenario: setup_storage.("#{base_dir}/file_storage", file_storage, setup_write_n_chunks),
  after_scenario: teardown_storage
})
|> Benchee.benchmark("PureFileStorage", {
  read_n_chunks_in_parallel,
  before_scenario:
    setup_storage.("#{base_dir}/pure_file_storage", pure_file_storage, setup_write_n_chunks),
  after_scenario: teardown_storage
})
|> Benchee.collect()
|> Benchee.statistics()
|> Benchee.load()
|> Benchee.relative_statistics()
|> Benchee.Formatter.output(Benchee.Formatters.Console)
