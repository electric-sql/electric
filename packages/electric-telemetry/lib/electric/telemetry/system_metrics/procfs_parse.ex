defmodule ElectricTelemetry.SystemMetrics.ProcfsParse do
  @moduledoc """
  Small, exhaustively defensive parsers for the flat `/proc` text files read by
  `ElectricTelemetry.SystemMetrics.Proc`.

  Every function degrades to an empty map (or `nil` for scalars) on a missing
  file, a permission error, or malformed content — it never raises. Parsing
  `/proc` is Electric's #1 historical crash cause, so the contract here is
  "skip the bad value, keep the good ones".

  No file content is ever turned into an atom (`String.to_atom/1`); keys stay
  binaries and the caller looks them up against compile-time literals.
  """

  @doc """
  Parse `/proc/meminfo` into a map of `binary key => integer kB value`.

  Lines look like `MemTotal:       16384000 kB`. The trailing `kB` unit (and any
  line that doesn't match `<key>: <int> [kB]`) is handled gracefully; values are
  returned in their native kB (the caller converts to bytes).
  """
  @spec read_meminfo(Path.t()) :: %{optional(binary()) => integer()}
  def read_meminfo(path) do
    case read_raw_file(path) do
      nil -> %{}
      content -> parse_keyed_kv(content)
    end
  end

  @doc """
  Parse `/proc/<pid>/status` into a map of `binary key => integer kB value` for
  the memory keys only.

  Lines look like `RssAnon:\t  12345 kB` or `VmRSS:\t  67890 kB`. Only lines
  whose value parses as an integer are kept; non-numeric keys (e.g. `Name`,
  `State`) are simply dropped. Values are returned in their native kB (the
  caller converts to bytes).
  """
  @spec read_status(Path.t()) :: %{optional(binary()) => integer()}
  def read_status(path) do
    case read_raw_file(path) do
      nil -> %{}
      content -> parse_keyed_kv(content)
    end
  end

  @doc """
  Parse `/proc/<pid>/io` into a map of `binary key => integer byte value`.

  Lines look like `read_bytes: 12345`. This file can be permission-restricted
  (EACCES) even for the reading process itself in some sandboxes; that read
  failure degrades to an empty map. Values are already in bytes.
  """
  @spec read_proc_io(Path.t()) :: %{optional(binary()) => integer()}
  def read_proc_io(path) do
    case read_raw_file(path) do
      nil -> %{}
      content -> parse_keyed_kv(content)
    end
  end

  # Parse a "<Key>:<whitespace><int>[ <unit>]" file (status, io) into a map of
  # binary key -> integer. The text after the colon is trimmed and split on
  # spaces; the first token is taken as the value and any trailing unit (e.g.
  # "kB") is ignored. Lines whose value doesn't parse as an integer are dropped.
  defp parse_keyed_kv(content) do
    content
    |> String.split("\n", trim: true)
    |> Enum.reduce(%{}, fn line, acc ->
      case String.split(line, ":", parts: 2) do
        [key, rest] ->
          case rest |> String.trim() |> String.split(" ", trim: true) do
            [value | _] ->
              case parse_int(value) do
                nil -> acc
                int -> Map.put(acc, key, int)
              end

            _ ->
              acc
          end

        _ ->
          acc
      end
    end)
  end

  ## low-level file/number helpers -----------------------------------------

  @doc """
  Read a file, returning its trimmed content or `nil` on any error (missing
  file, permission denied, …).
  """
  @spec read_raw_file(Path.t()) :: binary() | nil
  def read_raw_file(path) do
    case File.read(path) do
      {:ok, content} -> String.trim(content)
      {:error, _reason} -> nil
    end
  end

  @doc """
  Parse a string as an integer, returning `nil` on `nil` input or any
  non-integer content.
  """
  @spec parse_int(binary() | nil) :: integer() | nil
  def parse_int(nil), do: nil

  def parse_int(str) do
    case Integer.parse(String.trim(str)) do
      {int, ""} -> int
      _ -> nil
    end
  end
end
