defmodule Electric.Nifs.DiskRingBuf do
  @moduledoc """
  IPC-safe disk-backed ring buffer with backpressure.

  Vendored from lmdb_bench. See original module for full documentation.

  This module provides a high-performance, crash-resilient ring buffer that:
  - Persists data to disk via memory-mapped files
  - Uses backpressure (blocking writes when full) to prevent data loss
  - Supports two-phase read (peek + commit) for reliable processing
  - Designed for single-producer, single-consumer (SPSC) use
  """

  use Rustler,
    otp_app: :electric,
    crate: "disk_ringbuf_nif"

  @type t :: reference()
  @type data :: binary()
  @type sequence :: non_neg_integer()

  @spec open(Path.t(), non_neg_integer()) :: {:ok, t()} | {:error, term()}
  def open(_path, _capacity), do: :erlang.nif_error(:nif_not_loaded)

  @spec close(t()) :: :ok
  def close(_buffer), do: :erlang.nif_error(:nif_not_loaded)

  @spec flush(t()) :: :ok | {:error, term()}
  def flush(_buffer), do: :erlang.nif_error(:nif_not_loaded)

  @spec push(t(), data()) :: {:ok, sequence()} | {:error, term()}
  def push(_buffer, _data), do: :erlang.nif_error(:nif_not_loaded)

  @spec push_timeout(t(), data(), non_neg_integer()) :: {:ok, sequence()} | {:error, term()}
  def push_timeout(_buffer, _data, _timeout_ms), do: :erlang.nif_error(:nif_not_loaded)

  @spec try_push(t(), data()) :: {:ok, sequence()} | {:error, term()}
  def try_push(_buffer, _data), do: :erlang.nif_error(:nif_not_loaded)

  @spec pop(t()) :: {:ok, data()} | {:error, term()}
  def pop(_buffer), do: :erlang.nif_error(:nif_not_loaded)

  @spec pop_timeout(t(), non_neg_integer()) :: {:ok, data()} | {:error, term()}
  def pop_timeout(_buffer, _timeout_ms), do: :erlang.nif_error(:nif_not_loaded)

  @spec try_pop(t()) :: {:ok, data()} | :empty | {:error, term()}
  def try_pop(_buffer), do: :erlang.nif_error(:nif_not_loaded)

  @spec peek(t()) :: {:ok, data()} | :empty | {:error, term()}
  def peek(_buffer), do: :erlang.nif_error(:nif_not_loaded)

  @spec peek_n(t(), non_neg_integer()) :: {:ok, [data()]} | {:error, term()}
  def peek_n(_buffer, _n), do: :erlang.nif_error(:nif_not_loaded)

  @spec commit(t()) :: :ok | {:error, term()}
  def commit(_buffer), do: :erlang.nif_error(:nif_not_loaded)

  @spec commit_n(t(), non_neg_integer()) :: :ok | {:error, term()}
  def commit_n(_buffer, _n), do: :erlang.nif_error(:nif_not_loaded)

  @spec len(t()) :: non_neg_integer()
  def len(_buffer), do: :erlang.nif_error(:nif_not_loaded)

  @spec is_empty(t()) :: boolean()
  def is_empty(_buffer), do: :erlang.nif_error(:nif_not_loaded)

  @spec is_full(t()) :: boolean()
  def is_full(_buffer), do: :erlang.nif_error(:nif_not_loaded)

  @spec capacity(t()) :: non_neg_integer()
  def capacity(_buffer), do: :erlang.nif_error(:nif_not_loaded)

  @spec max_record_size(t()) :: non_neg_integer()
  def max_record_size(_buffer), do: :erlang.nif_error(:nif_not_loaded)
end
