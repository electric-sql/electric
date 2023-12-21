defmodule Electric.Errors do
  @margin "▓ "

  @type error_kind :: atom

  def failed_to_start_child_error(error_kind, child_id, reason) do
    format_error(
      error_kind,
      """
      Failed to start child #{inspect(child_id)}:
        #{inspect(reason)}
      """,
      """
      Please file a new issue on GitHub[1], including the contents of this error.

      [1]: https://github.com/electric-sql/electric/issues
      """
    )
  end

  @spec print_fatal_error(iodata) :: no_return
  @spec print_fatal_error(error_kind, String.t()) :: no_return
  @spec print_fatal_error(error_kind, String.t(), String.t()) :: no_return
  def print_fatal_error(error_iodata) when is_binary(error_iodata) or is_list(error_iodata) do
    IO.puts(error_iodata)

    """

    ••• Shutting down •••
    """
    |> colorize()
    |> IO.puts()

    System.halt(1)
  end

  def print_fatal_error(error_kind, message, extra \\ nil) do
    format_error(error_kind, message, extra)
    |> print_fatal_error()
  end

  @spec print_error(error_kind, String.t()) :: :ok
  @spec print_error(error_kind, String.t(), String.t() | nil) :: :ok
  def print_error(error_kind, message, extra \\ nil) do
    format_error(error_kind, message, extra)
    |> IO.puts()
  end

  @doc """
  Sample error message:

  ▓ ┌────────────────────────────────┐
  ▓ │  DATABASE CONFIGURATION ERROR  │
  ▓ ┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┙
  ▓
  ▓ Your Postgres database is not configured with wal_level=logical.
  ▓
  ▓
  ▓ Visit https://electric-sql.com/docs/usage/installation/postgres
  ▓ to learn more about Electric's requirements for Postgres.
  """
  @spec format_error(error_kind, String.t()) :: iolist
  @spec format_error(error_kind, String.t(), String.t() | nil) :: iolist
  def format_error(error_kind, message, extra \\ nil) do
    [format_header(error_kind), "", message]
    |> append_extra(extra)
    |> add_margin()
    |> Enum.join("\n")
    |> String.trim()
    |> colorize()
  end

  defp append_extra(strings, nil), do: strings
  defp append_extra(strings, extra), do: strings ++ ["", extra]

  defp format_header(:init) do
    """
    ┌────────────────────────┐
    │  INITIALISATION ERROR  │
    ┕━━━━━━━━━━━━━━━━━━━━━━━━┙
    """
  end

  defp format_header(:conn) do
    """
    ┌────────────────────┐
    │  CONNECTION ERROR  │
    ┕━━━━━━━━━━━━━━━━━━━━┙
    """
  end

  defp format_header(:conf) do
    """
    ┌───────────────────────┐
    │  CONFIGURATION ERROR  │
    ┕━━━━━━━━━━━━━━━━━━━━━━━┙
    """
  end

  defp format_header(:dbconf) do
    """
    ┌────────────────────────────────┐
    │  DATABASE CONFIGURATION ERROR  │
    ┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┙
    """
  end

  defp format_header(module_alias) do
    module_line = "  MODULE ERROR: " <> inspect(module_alias) <> "  "
    n = byte_size(module_line)

    """
    ┌#{String.duplicate("─", n)}┐
    │#{module_line}│
    ┕#{String.duplicate("━", n)}┙
    """
  end

  defp add_margin(str) when is_binary(str) do
    str
    |> String.trim()
    |> String.split("\n")
    |> Enum.map(&(@margin <> &1))
    |> Enum.join("\n")
  end

  defp add_margin(strings) when is_list(strings) do
    strings
    |> Enum.reject(&is_nil/1)
    |> Enum.map(&add_margin/1)
  end

  defp colorize(text), do: IO.ANSI.format([:red, text])
end
