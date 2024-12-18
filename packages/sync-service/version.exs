# This helper script is evaluated in mix.exs to obtain the Mix project version.

defmodule Electric.Version do
  def version(default \\ nil) do
    with :error <- version_from_env(),
         :error <- version_from_package_json() do
      default
    end
  end

  def write_static_version(file) do
    File.write!(file, inspect(version()))
  end

  defp version_from_env do
    with {:ok, version} <- System.fetch_env("ELECTRIC_VERSION"),
         trimmed = String.trim(version),
         {:ok, _} <- Version.parse(trimmed) do
      trimmed
    end
  end

  defp version_from_package_json do
    case File.read("./package.json") do
      {:ok, binary} -> binary |> :json.decode() |> Map.fetch!("version")
      {:error, _} -> :error
    end
  end
end

Electric.Version.version()
