defmodule ElectricTelemetry.DiskUsage.Disk do
  require Record

  Record.defrecord(:file_info, Record.extract(:file_info, from_lib: "kernel/include/file.hrl"))

  def recursive_usage(path, exclude) do
    do_recursive_usage(path, MapSet.new(exclude), 0)
  end

  def do_recursive_usage(path, exclude, acc) do
    case stat(path) do
      {:ok, file_info(size: size, type: :regular)} ->
        if MapSet.member?(exclude, path) do
          acc
        else
          size + acc
        end

      {:ok, file_info(type: :directory)} ->
        case ls(path) do
          {:ok, files} ->
            Enum.reduce(files, acc, &do_recursive_usage(Path.join(path, &1), exclude, &2))

          {:error, _} ->
            0
        end

      {:ok, _} ->
        0

      {:error, _} ->
        0
    end
  end

  defdelegate stat(path), to: :prim_file, as: :read_file_info

  defp ls(path) do
    :prim_file.list_dir(path)
  end
end
