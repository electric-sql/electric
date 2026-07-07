defmodule ElectricTelemetry.SystemMetrics.ProcfsParse do
  @moduledoc """
  Small, exhaustively defensive parsers for the flat text files exposed by
  procfs and cgroupfs.

  Every function degrades to an empty map (or `nil` for scalars) on a missing
  file, a permission error, or malformed content — it never raises. Parsing
  `/proc` is Electric's #1 historical crash cause, so the contract here is
  "skip the bad value, keep the good ones".

  No file content is ever turned into an atom (`String.to_atom/1`); keys stay
  binaries and the caller looks them up against compile-time literals.
  """

  @doc """
  Parse a flat key/value file — `/proc/meminfo`, `/proc/<pid>/status`,
  `/proc/<pid>/io`, cgroup `memory.stat`/`cpu.stat` — into a map of
  `binary key => integer value`.

  Handles both the `key value` and `Key:\twhitespace-padded value [unit]` line
  layouts: the key is the first whitespace-delimited token with any trailing
  `:` stripped, the value is the second token, and any trailing unit (e.g.
  `kB`) is ignored. Lines whose value doesn't parse as an integer are dropped.
  Values keep their native unit (the caller converts, e.g. kB -> bytes).
  """
  @spec read_kv_file(Path.t()) :: %{optional(binary()) => integer()}
  def read_kv_file(path) do
    for line <- String.split(read_raw_file(path) || "", "\n", trim: true),
        [key, value | _] <- [String.split(line)],
        int = parse_int(value),
        into: %{},
        do: {String.trim_trailing(key, ":"), int}
  end

  @doc """
  Read a single-integer file (e.g. cgroup `memory.current`), returning `nil`
  on any read or parse error.
  """
  @spec read_int_file(Path.t()) :: integer() | nil
  def read_int_file(path), do: parse_int(read_raw_file(path))

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

  @doc """
  Parse a string as a float, returning `nil` on `nil` input or any non-float
  content.
  """
  @spec parse_float(binary() | nil) :: float() | nil
  def parse_float(nil), do: nil

  def parse_float(str) do
    case Float.parse(String.trim(str)) do
      {float, ""} -> float
      _ -> nil
    end
  end
end
