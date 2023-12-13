defmodule Electric.Errors do
  @margin "▓ "

  def print_fatal_error(error_kind, message, extra \\ nil) do
    print_error(error_kind, message, extra)

    """

    ••• Shutting down •••
    """
    |> colorize()
    |> IO.puts()

    System.halt(1)
  end

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

  defp format_header(:dbconf) do
    """
    ┌────────────────────────────────┐
    │  DATABASE CONFIGURATION ERROR  │
    ┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┙
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
