defmodule Electric.Config do
  @type maybe_string :: binary | nil

  @spec parse_database_url(maybe_string, :dev | :test | :prod) ::
          {:ok, keyword | nil} | {:error, binary}
  def parse_database_url(val, config_env) do
    if is_nil(val) or String.trim(val) == "" do
      if config_env == :test do
        {:ok, nil}
      else
        {:error, "not set"}
      end
    else
      Electric.Utils.parse_postgresql_uri(val)
    end
  end

  @spec parse_write_to_pg_mode(binary) :: {:ok, Electric.write_to_pg_mode()} | {:error, binary}
  def parse_write_to_pg_mode("logical_replication"), do: {:ok, :logical_replication}
  def parse_write_to_pg_mode("direct_writes"), do: {:ok, :direct_writes}

  def parse_write_to_pg_mode(str) do
    if String.trim(str) == "" do
      {:error, "erroneously set to an empty value"}
    else
      {:error, "has invalid value: #{inspect(str)}"}
    end
  end

  @spec parse_logical_publisher_host(
          maybe_string,
          {:ok, Electric.write_to_pg_mode()} | {:error, binary}
        ) :: {:ok, maybe_string} | {:error, binary}
  def parse_logical_publisher_host(val, {:ok, :direct_writes}), do: {:ok, val}

  def parse_logical_publisher_host(val, _) do
    if is_nil(val) or String.trim(val) == "" do
      {:error, "not set"}
    else
      {:ok, val}
    end
  end

  @spec parse_log_level(binary) :: {:ok, Logger.level()} | {:error, binary}

  def parse_log_level(str)
      when str in ~w[emergency alert critical error warning warn notice info debug],
      do: {:ok, String.to_existing_atom(str)}

  def parse_log_level(str) do
    {:error, "has invalid value: #{inspect(str)}"}
  end

  @spec parse_pg_proxy_password(maybe_string) :: {:ok, maybe_string} | {:error, binary}
  def parse_pg_proxy_password(val) do
    if is_nil(val) or String.trim(val) == "" do
      {:error, "not set"}
    else
      {:ok, val}
    end
  end
end
