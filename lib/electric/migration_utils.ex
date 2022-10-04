defmodule Electric.Migration.Utils do
  @type vsn() :: String.t()

  @spec available_migrations() :: [vsn()]
  def available_migrations() do
    migration_path = Application.get_env(:electric, Electric.Migrations)

    Enum.map(
      Path.wildcard(Path.join(migration_path, "*.sql")),
      &Path.basename(&1, ".sql")
    )
  end

  @spec read_migration_file(vsn()) :: {:ok, binary} | {:error, term}
  def read_migration_file(vsn) do
    file = get_migration_path(vsn)

    case File.exists?(file) do
      true ->
        File.read(file)

      false ->
        {:error, :vsn_not_found}
    end
  end

  @spec get_migration_path(vsn()) :: binary
  def get_migration_path(vsn) do
    migration_path =
      Keyword.fetch!(
        Application.get_env(:electric, Electric.Migrations),
        :dir
      )

    Path.join(migration_path, vsn <> ".sql")
  end
end
