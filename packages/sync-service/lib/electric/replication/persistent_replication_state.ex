defmodule Electric.Replication.PersistentReplicationState do
  alias Electric.PersistentKV
  alias Electric.Postgres.Lsn
  require Logger

  @type opts() :: [
          stack_id: String.t(),
          persistent_kv: Electric.PersistentKV.t()
        ]

  @last_processed_lsn_key "last_processed_lsn"

  @spec set_last_processed_lsn(Lsn.t() | non_neg_integer(), opts()) :: :ok
  def set_last_processed_lsn(lsn, opts) when is_struct(lsn, Lsn) do
    lsn |> Lsn.to_integer() |> set_last_processed_lsn(opts)
  end

  def set_last_processed_lsn(lsn, opts) when is_integer(lsn) do
    Logger.debug("Updating last processed lsn to #{lsn}")
    set(@last_processed_lsn_key, lsn, opts)
  end

  @spec get_last_processed_lsn(opts()) :: Lsn.t()
  def get_last_processed_lsn(opts) do
    case get(@last_processed_lsn_key, opts) do
      {:ok, last_processed_lsn} -> last_processed_lsn
      {:error, :not_found} -> 0
    end
    |> Lsn.from_integer()
  end

  @spec reset(opts()) :: :ok
  def reset(opts) do
    set(@last_processed_lsn_key, 0, opts)
  end

  @spec set(String.t(), any(), opts()) :: :ok
  defp set(key, value, opts) do
    persistent_kv = Access.fetch!(opts, :persistent_kv)
    stack_id = Access.fetch!(opts, :stack_id)
    PersistentKV.set(persistent_kv, "#{stack_id}:#{key}", value)
  end

  @spec get(String.t(), opts()) :: {:ok, any()} | {:error, :not_found}
  defp get(key, opts) do
    persistent_kv = Access.fetch!(opts, :persistent_kv)
    stack_id = Access.fetch!(opts, :stack_id)
    PersistentKV.get(persistent_kv, "#{stack_id}:#{key}")
  end
end
