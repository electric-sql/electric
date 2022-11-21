defmodule Electric.Migration.Utils do
  require Logger

  @type vsn() :: String.t()

  @spec read_migration_file(vsn()) :: {:ok, binary} | {:error, term}
  def read_migration_file(vsn) do
    file = get_migration_path(vsn)

    case File.exists?(file) do
      true ->
        File.read(file)

      false ->
        Logger.warn("migration not found: #{file}")
        {:error, :vsn_not_found}
    end
  end

  @spec get_migration_path(vsn()) :: binary
  def get_migration_path(vsn) do
    migration_dir = fetch_config!(:dir)
    file_name_suffix = fetch_config!(:migration_file_name_suffix)
    Path.join(migration_dir, vsn <> file_name_suffix)
  end

  defp fetch_config!(key) when key in [:dir, :migration_file_name_suffix] do
    Keyword.fetch!(
      Application.get_env(:electric, Electric.Migrations),
      key
    )
  end
end
