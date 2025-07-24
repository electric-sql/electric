alias Electric.Replication.LogOffset
alias Electric.ShapeCache.PureFileStorage.ChunkIndex

base_dir = System.get_env("BENCH_DIR", "tmp/chunk_find_bench")

Benchee.run(
  %{
    "fetch_chunk_1" => fn {path, offset} ->
      ChunkIndex.fetch_chunk_1(path, offset)
    end,
    "fetch_chunk" => fn {path, offset} ->
      ChunkIndex.fetch_chunk(path, offset)
    end,
    "fetch_chunk_2" => fn {path, offset} ->
      ChunkIndex.fetch_chunk_2(path, offset)
    end
  },
  time: 5,
  inputs: %{"50 chunks" => 50, "200 chunks" => 200, "500 chunks" => 500},
  before_each: fn {input, path} ->
    {path, LogOffset.new(Enum.random(0..input), Enum.random([0, 2, 4]))}
  end,
  before_scenario: fn input ->
    File.mkdir_p!("#{base_dir}")

    1..input
    |> Enum.flat_map(fn i ->
      [
        {%LogOffset{tx_offset: i, op_offset: 0}, 10, nil, nil, nil, 100, nil},
        {%LogOffset{tx_offset: i, op_offset: 2}, 10, nil, nil, nil, 100, nil},
        {%LogOffset{tx_offset: i, op_offset: 4}, 10, nil, nil, nil, 100, nil}
      ]
    end)
    |> ChunkIndex.write_from_stream("#{base_dir}/chunk_index", 250)
    |> Stream.run()

    {input, "#{base_dir}/chunk_index"}
  end,
  after_scenario: fn {_, file_path} ->
    File.rm_rf!(file_path)
  end
)
