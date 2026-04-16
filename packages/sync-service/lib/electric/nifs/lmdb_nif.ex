defmodule Electric.Nifs.LmdbNif do
  @moduledoc """
  High-performance LMDB NIF using Rust and dirty schedulers.

  Vendored from lmdb_bench. All functions take a single `db` reference
  (a NIF resource containing both the LMDB environment and database handle),
  returned by `open/1`.
  """

  use Rustler,
    otp_app: :electric,
    crate: "lmdb_nif"

  @type db :: reference()
  @type key :: binary()
  @type value :: binary()

  @spec open(String.t(), non_neg_integer(), non_neg_integer(), boolean(), String.t() | nil) :: db()
  def open(_path, _map_size \\ 1_073_741_824, _max_dbs \\ 1, _nosync \\ true, _db_name \\ nil),
    do: :erlang.nif_error(:nif_not_loaded)

  @spec get(db(), key()) :: {:ok, value()} | :not_found | {:error, term()}
  def get(_db, _key), do: :erlang.nif_error(:nif_not_loaded)

  @reserved_key <<0>>

  @spec put(db(), key(), value()) :: :ok | {:error, term()}
  def put(_db, @reserved_key, _value), do: raise(ArgumentError, "key <<0>> is reserved")
  def put(db, key, value), do: nif_put(db, key, value)

  defp nif_put(_db, _key, _value), do: :erlang.nif_error(:nif_not_loaded)

  @spec batch_put(db(), [{key(), value()}]) :: :ok | {:error, term()}
  def batch_put(db, pairs) do
    if Enum.any?(pairs, fn {k, _v} -> k == @reserved_key end) do
      raise ArgumentError, "key <<0>> is reserved"
    end

    nif_batch_put(db, pairs)
  end

  defp nif_batch_put(_db, _pairs), do: :erlang.nif_error(:nif_not_loaded)

  @spec batch_get(db(), [key()]) :: [{:ok, value()} | :not_found] | {:error, term()}
  def batch_get(_db, _keys), do: :erlang.nif_error(:nif_not_loaded)

  @spec delete(db(), key()) :: :ok | {:error, term()}
  def delete(_db, _key), do: :erlang.nif_error(:nif_not_loaded)

  @spec delete_keys(db(), [key()]) :: :ok | {:error, term()}
  def delete_keys(_db, _keys), do: :erlang.nif_error(:nif_not_loaded)

  @spec drain(db(), pos_integer()) :: {:ok, [{key(), value()}]} | :empty
  def drain(db, limit) do
    case iterate_from(db, <<0>>, limit) do
      {:ok, []} -> :empty
      {:ok, entries} -> {:ok, entries}
    end
  end

  @doc """
  Peek at entries after `after_key`. Returns entries with keys strictly
  greater than `after_key`. Used to pipeline multiple in-flight batches
  from the same LMDB queue.
  """
  @spec drain_after(db(), key(), pos_integer()) :: {:ok, [{key(), value()}]} | :empty
  def drain_after(db, after_key, limit) do
    # iterate_from uses >= semantics, so we need to skip the after_key itself.
    # Fetch limit+1 entries starting from after_key, drop any that match it.
    case iterate_from(db, after_key, limit + 1) do
      {:ok, []} ->
        :empty

      {:ok, [{^after_key, _} | rest]} ->
        case rest do
          [] -> :empty
          entries -> {:ok, Enum.take(entries, limit)}
        end

      {:ok, entries} ->
        # after_key wasn't in the result (already deleted), entries are all > after_key
        {:ok, Enum.take(entries, limit)}
    end
  end

  @spec ack(db(), [{key(), value()}]) :: :ok | {:error, term()}
  def ack(db, entries) do
    keys = Enum.map(entries, fn {key, _value} -> key end)
    delete_keys(db, keys)
  end

  @spec iterate_all(db()) :: {:ok, non_neg_integer()} | {:error, term()}
  def iterate_all(_db), do: :erlang.nif_error(:nif_not_loaded)

  @spec iterate_from(db(), key(), non_neg_integer()) ::
          {:ok, [{key(), value()}]} | {:error, term()}
  def iterate_from(_db, _start_key, _limit), do: :erlang.nif_error(:nif_not_loaded)

  @spec iterate_range(db(), key(), key(), non_neg_integer()) ::
          {:ok, [{key(), value()}]} | {:error, term()}
  def iterate_range(_db, _start_key, _end_key, _limit), do: :erlang.nif_error(:nif_not_loaded)

  @spec size(db()) :: non_neg_integer() | {:error, term()}
  def size(_db), do: :erlang.nif_error(:nif_not_loaded)

  @spec clear(db()) :: :ok | {:error, term()}
  def clear(_db), do: :erlang.nif_error(:nif_not_loaded)

  @spec sync(db()) :: :ok | {:error, term()}
  def sync(_db), do: :erlang.nif_error(:nif_not_loaded)

  @spec stream(db(), key(), keyword()) :: Enumerable.t()
  def stream(db, start_key, opts \\ []) do
    %Electric.Nifs.LmdbNif.Stream{db: db, start_key: start_key, batch_size: opts[:batch_size] || 100}
  end
end
