defmodule Electric.Nifs.DiskQueue do
  @moduledoc """
  Segmented disk-backed SPSC work queue NIF.

  Vendored from lmdb_bench. See `DiskQueue` in that project for full docs.
  """

  use Rustler,
    otp_app: :electric,
    crate: "disk_queue_nif"

  @type t :: reference()
  @type data :: binary()
  @type sequence :: non_neg_integer()

  @default_segment_size 16 * 1024
  @seq_width 20

  @spec open(Path.t(), keyword()) :: {:ok, t()} | {:error, term()}
  def open(path, opts \\ []) do
    segment_size = Keyword.get(opts, :segment_size, @default_segment_size)
    nif_open(to_string(path), segment_size)
  end

  defp nif_open(_path, _segment_size), do: :erlang.nif_error(:nif_not_loaded)

  @spec close(t()) :: :ok
  def close(_queue), do: :erlang.nif_error(:nif_not_loaded)

  @spec push(t(), data()) :: {:ok, sequence()} | {:error, term()}
  def push(_queue, _data), do: :erlang.nif_error(:nif_not_loaded)

  @spec batch_push(t(), [data()]) :: {:ok, [sequence()]} | {:error, term()}
  def batch_push(queue, items) when is_list(items) do
    Enum.reduce_while(items, {:ok, []}, fn item, {:ok, seqs} ->
      case push(queue, item) do
        {:ok, seq} -> {:cont, {:ok, [seq | seqs]}}
        {:error, _} = err -> {:halt, err}
      end
    end)
    |> case do
      {:ok, seqs} -> {:ok, Enum.reverse(seqs)}
      error -> error
    end
  end

  @spec try_push(t(), data()) :: {:ok, sequence()} | {:error, term()}
  def try_push(_queue, _data), do: :erlang.nif_error(:nif_not_loaded)

  @spec pop(t()) :: {:ok, data()} | {:error, term()}
  def pop(_queue), do: :erlang.nif_error(:nif_not_loaded)

  @spec pop_timeout(t(), non_neg_integer()) :: {:ok, data()} | {:error, term()}
  def pop_timeout(_queue, _timeout_ms), do: :erlang.nif_error(:nif_not_loaded)

  @spec try_pop(t()) :: {:ok, data()} | :empty | {:error, term()}
  def try_pop(_queue), do: :erlang.nif_error(:nif_not_loaded)

  @spec peek(t()) :: {:ok, {sequence(), data()}} | :empty | {:error, term()}
  def peek(_queue), do: :erlang.nif_error(:nif_not_loaded)

  @spec peek_n(t(), non_neg_integer()) :: {:ok, [{sequence(), data()}]} | {:error, term()}
  def peek_n(_queue, _n), do: :erlang.nif_error(:nif_not_loaded)

  @spec peek_after(t(), non_neg_integer()) ::
          {:ok, [{sequence(), data()}]} | {:error, term()}
  def peek_after(_queue, _after_id), do: :erlang.nif_error(:nif_not_loaded)

  @spec peek_after_n(t(), non_neg_integer(), pos_integer()) ::
          {:ok, [{sequence(), data()}]} | {:error, term()}
  def peek_after_n(queue, after_id, limit) do
    case peek_after(queue, after_id) do
      {:ok, records} -> {:ok, Enum.take(records, limit)}
      error -> error
    end
  end

  @spec commit(t()) :: :ok | {:error, term()}
  def commit(_queue), do: :erlang.nif_error(:nif_not_loaded)

  @spec commit_n(t(), non_neg_integer()) :: :ok | {:error, term()}
  def commit_n(_queue, _n), do: :erlang.nif_error(:nif_not_loaded)

  @spec rewind_peek(t()) :: :ok | {:error, term()}
  def rewind_peek(_queue), do: :erlang.nif_error(:nif_not_loaded)

  @spec size(t()) :: non_neg_integer()
  def size(_queue), do: :erlang.nif_error(:nif_not_loaded)

  @spec is_empty(t()) :: boolean()
  def is_empty(_queue), do: :erlang.nif_error(:nif_not_loaded)

  @doc """
  Format a sequence number as a zero-padded string for Stream-Seq headers.
  Lexicographic ordering matches numeric ordering.
  """
  @spec format_seq(sequence()) :: String.t()
  def format_seq(seq) when is_integer(seq) do
    seq |> Integer.to_string() |> String.pad_leading(@seq_width, "0")
  end
end
