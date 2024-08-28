defmodule Electric.PersistentKV.Filesystem do
  require Logger

  defstruct root: "."

  @schema NimbleOptions.new!(root: [type: :string, required: true])

  def new!(opts) do
    {:ok, config} = NimbleOptions.validate(opts, @schema)
    struct(__MODULE__, config)
  end

  defimpl Electric.PersistentKV do
    def get(fs, key) do
      path = join(fs, key)

      case File.read(path) do
        {:ok, data} -> {:ok, data}
        {:error, :enoent} -> {:error, :not_found}
        error -> error
      end
    end

    def set(fs, key, value) when is_binary(key) do
      with file_path = mkdir(fs, key),
           :ok <- atomic_write(file_path, value) do
        Logger.debug("[SET] #{file_path}")
        :ok
      end
    end

    # rename is atomic if files are on same fs
    # removes chance of reading partial write
    defp atomic_write(final_path, data) do
      tmp_file =
        final_path
        |> Path.dirname()
        |> Path.join(
          "." <> (:crypto.strong_rand_bytes(10) |> Base.encode32(case: :lower, padding: false))
        )

      with :ok <- File.write(tmp_file, data, [:binary]) do
        File.rename(tmp_file, final_path)
      end
    end

    defp mkdir(fs, key) do
      path = join(fs, key)
      dir = Path.dirname(path)
      File.mkdir_p!(dir)
      path
    end

    defp join(fs, key), do: Path.join(fs.root, key) |> Path.expand()
  end
end
