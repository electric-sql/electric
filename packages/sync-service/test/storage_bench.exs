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

sqlite_storage =
  {Electric.ShapeCache.SqliteStorage,
   Electric.ShapeCache.SqliteStorage.shared_opts(
     storage_dir: "#{base_dir}/sqlite_storage",
     stack_id: "test-stack"
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

setup_storage = fn folder, storage, init_fn ->
  fn input ->
    File.rm_rf!(folder)
    shape_opts = Storage.for_shape("test-shape-1", storage)

    pid =
      case Storage.start_link(shape_opts) do
        {:ok, pid} -> pid
        :ignore -> nil
      end

    Storage.initialise(shape_opts)
    Storage.mark_snapshot_as_started(shape_opts)
    Storage.make_new_snapshot!([], shape_opts)
    init_fn.({input, %{pid: pid, storage: shape_opts}})
  end
end

teardown_storage = fn {_, %{pid: pid, storage: storage}} ->
  if pid do
    Process.unlink(pid)
    Process.exit(pid, :shutdown)
  end

  Storage.unsafe_cleanup!(storage)
end

test_appends = fn {input, %{storage: storage}} = context ->
  Storage.append_to_log!(input, storage)
  context
end

# Test 1 - writes to single shape
Benchee.init(
  time: 5,
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
|> Benchee.benchmark("SQLiteStorage", {
  test_appends,
  before_scenario: setup_storage.("#{base_dir}/sqlite_storage", sqlite_storage, & &1),
  after_scenario: teardown_storage
})
|> Benchee.collect()
|> Benchee.statistics()
|> Benchee.load()
|> Benchee.relative_statistics()
|> Benchee.Formatter.output(Benchee.Formatters.Console)

# Test 2 - chunk-aligned reads from random points

inputs = %{
  "5 chunks" => 5,
  "10 chunks" => 10
}

write_n_chunks = fn n, storage ->
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
  |> Stream.transform({0, n}, fn
    {offset, log_item}, {acc, n} when n > 0 ->
      line_tuple = {offset, log_item.key, log_item.headers.operation, Jason.encode!(log_item)}

      if acc == 39000,
        do: {[line_tuple, {:chunk_boundary, offset}], {0, n - 1}},
        else: {[line_tuple], {acc + 1, n}}

    _, {_, 0} ->
      {:halt, nil}
  end)
  |> Stream.chunk_every(200)
  # |> Stream.each(&IO.inspect(&1, label: "line_tuple"))
  |> Enum.each(&Storage.append_to_log!(&1, storage))

  IO.puts("Written #{n} chunks in #{System.monotonic_time(:millisecond) - start_time}ms")

  1..(39000 * n)
end

setup_write_n_chunks =
  fn {n, %{storage: storage} = ctx} -> {write_n_chunks.(n, storage), ctx} end

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
|> Benchee.benchmark("SQLiteStorage", {
  read_chunk,
  before_scenario:
    setup_storage.("#{base_dir}/sqlite_storage", sqlite_storage, setup_write_n_chunks),
  after_scenario: teardown_storage
})

# |> Benchee.collect()
# |> Benchee.statistics()
# |> Benchee.load()
# |> Benchee.relative_statistics()
# |> Benchee.Formatter.output(Benchee.Formatters.Console)

# Test 3 - High concurrency reads from same shape

read_n_chunks_in_parallel = fn {inputs, %{storage: storage}} ->
  Task.async_stream(inputs, fn input -> read_chunk.({input, %{storage: storage}}) end,
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
|> Benchee.benchmark("SQLiteStorage", {
  read_n_chunks_in_parallel,
  before_scenario:
    setup_storage.("#{base_dir}/sqlite_storage", sqlite_storage, setup_write_n_chunks),
  after_scenario: teardown_storage
})

# |> Benchee.collect()
# |> Benchee.statistics()
# |> Benchee.load()
# |> Benchee.relative_statistics()
# |> Benchee.Formatter.output(Benchee.Formatters.Console)
