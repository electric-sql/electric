defmodule Electric.ShapeCache.PureFileStorage.FileInfo do
  require Record
  alias Electric.ShapeCache.Storage
  Record.defrecord(:file_info, Record.extract(:file_info, from_lib: "kernel/include/file.hrl"))

  def file_size(path) do
    with {:ok, info} <- :prim_file.read_file_info(path) do
      {:ok, file_info(info, :size)}
    end
  end

  def get_file_size!(path) do
    case file_size(path) do
      {:ok, result} ->
        result

      {:error, :enoent} ->
        nil

      {:error, reason} ->
        raise Storage.Error, message: inspect(reason)
    end
  end

  defdelegate stat(path), to: :prim_file, as: :read_file_info

  def ls(path) do
    with {:ok, list} <- :prim_file.list_dir(path) do
      {:ok, Enum.map(list, &to_string/1)}
    end
  end

  def mkdir_p(path) do
    if match?({:ok, file_info(type: :directory)}, stat(path)) do
      :ok
    else
      parent = Path.dirname(path)

      if parent == path do
        {:error, :einval}
      else
        _ = mkdir_p(parent)

        case :prim_file.make_dir(path) do
          {:error, :eexist} = error ->
            if dir?(path), do: :ok, else: error

          other ->
            other
        end
      end
    end
  end

  def dir?(path), do: match?({:ok, file_info(type: :directory)}, stat(path))

  def exists?(path), do: match?({:ok, _}, :prim_file.read_file_info(path))

  defdelegate rename(old, new), to: :prim_file

  def recursive_disk_usage(path, acc \\ 0) do
    case stat(path) do
      {:ok, file_info(size: size, type: :regular)} ->
        size + acc

      {:ok, file_info(type: :directory)} ->
        case ls(path) do
          {:ok, files} ->
            Enum.reduce(files, acc, &recursive_disk_usage(Path.join(path, &1), &2))

          {:error, _} ->
            0
        end

      {:ok, _} ->
        0

      {:error, _} ->
        0
    end
  end

  def truncate(path, size) do
    File.open!(path, [:read, :write, :raw], fn file ->
      :file.position(file, size)
      :file.truncate(file)
    end)
  end

  def delete(path) do
    :prim_file.delete(path)
  end
end
