defmodule ElectricTelemetry.DiskUsage.Disk do
  require Record

  Record.defrecord(:file_info, Record.extract(:file_info, from_lib: "kernel/include/file.hrl"))

  @doc """
  Recursively sum the size of all regular files under `path`, excluding any
  paths listed in `exclude`.
  """
  def recursive_usage(path, exclude) do
    {total, _buckets} = recursive_usage_grouped(path, exclude, nil)
    total
  end

  @doc """
  Like `recursive_usage/2`, but in the same single traversal also returns a map
  of per-directory subtotals bucketed at `group_depth` (`nil` disables
  bucketing and yields an empty map).

  The bucket map is keyed by the name (not full path) of each directory found
  at exactly `group_depth` levels below `path` (the root `path` itself is depth
  0), with the value being the recursive size of every regular file under that
  directory. Excluded paths contribute to neither the total nor the buckets.
  The buckets are a best-effort tally that only ever grows, while the total
  keeps the legacy behaviour of resetting to 0 on an unreadable entry.

  Returns `{total_bytes, %{dir_name => bytes}}`.
  """
  def recursive_usage_grouped(path, exclude, group_depth)
      when is_nil(group_depth) or (is_integer(group_depth) and group_depth >= 0) do
    # When grouping at the root (depth 0), the root's own basename is the bucket.
    initial_key = if group_depth == 0, do: Path.basename(path), else: nil
    walk(path, initial_key, MapSet.new(exclude), group_depth, 0, {0, %{}})
  end

  # `bucket_key` is the name of the ancestor directory sitting at `group_depth`,
  # or `nil` until that depth is reached.
  defp walk(path, bucket_key, exclude, group_depth, depth, {acc, buckets}) do
    case stat(path) do
      {:ok, file_info(size: size, type: :regular)} ->
        if MapSet.member?(exclude, path) do
          {acc, buckets}
        else
          {size + acc, add_to_bucket(buckets, bucket_key, size)}
        end

      {:ok, file_info(type: :directory)} ->
        case ls(path) do
          {:ok, files} ->
            Enum.reduce(files, {acc, buckets}, fn name, {acc, bucks} ->
              # `name` is a charlist from :prim_file.list_dir/1 and sits at
              # `depth + 1`. Once established, the bucket key propagates to all
              # descendants.
              child_bucket_key =
                cond do
                  not is_nil(bucket_key) -> bucket_key
                  depth + 1 == group_depth -> List.to_string(name)
                  true -> nil
                end

              walk(
                Path.join(path, name),
                child_bucket_key,
                exclude,
                group_depth,
                depth + 1,
                {acc, bucks}
              )
            end)

          {:error, _} ->
            {0, buckets}
        end

      {:ok, _} ->
        {0, buckets}

      {:error, _} ->
        {0, buckets}
    end
  end

  defp add_to_bucket(buckets, nil, _size), do: buckets

  defp add_to_bucket(buckets, key, size) do
    Map.update(buckets, key, size, &(&1 + size))
  end

  defdelegate stat(path), to: :prim_file, as: :read_file_info

  defp ls(path) do
    :prim_file.list_dir(path)
  end
end
