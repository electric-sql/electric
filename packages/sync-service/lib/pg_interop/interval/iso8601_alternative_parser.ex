defmodule PgInterop.Interval.ISO8601AlternativeParser do
  @moduledoc """
  This module parses alternative ISO-8601 duration strings into Interval structs.
  """
  alias PgInterop.Interval

  @doc """
  Parses an ISO-8601 formatted duration string into a Interval struct.
  The parse result is wrapped in a :ok/:error tuple.

  ## Examples

      iex> parse("P0015-3-2T1:14:37.25")
      {:ok, Interval.parse!("P15Y3M2DT1H14M37.25S")}

      iex> parse("P0015-3-2")
      {:ok, Interval.parse!("P15Y3M2D")}

      iex> parse("PT3:12:25.001")
      {:ok, Interval.parse!("PT3H12M25.001S")}

      iex> parse("P0015T30:00")
      {:ok, Interval.parse!("P15YT30H")}

      iex> parse("")
      {:error, "input string cannot be empty"}
      iex> parse("W")
      {:error, "expected P, got W"}
      iex> parse("P0015TT30:00")
      {:error, "unexpected duplicate T"}
      iex> parse("P0015-3-2-1")
      {:error, "unexpected 4th section in y-m-d part"}
      iex> parse("P0015-3-y")
      {:error, "invalid number `y`"}
      iex> parse("P0015-3-1T30:00:10.y")
      {:error, "invalid number `10.y`"}
  """
  @spec parse(String.t()) :: {:ok, Interval.t()} | {:error, term}
  def parse(<<>>), do: {:error, "input string cannot be empty"}

  def parse(<<?P, rest::binary>>) do
    with {:ok, ymd, hms} <- split_on_time(rest),
         {:ok, ymd_duration} <- validate_ymd(ymd),
         {:ok, hms_duration} <- validate_hms(hms) do
      {:ok, Interval.add(ymd_duration, hms_duration)}
    end
  end

  def parse(<<c::utf8, _::binary>>), do: {:error, "expected P, got #{<<c::utf8>>}"}

  def split_on_time(x) do
    case String.split(x, "T") do
      [x] -> {:ok, x, nil}
      [yml, hms] -> {:ok, yml, hms}
      _ -> {:error, "unexpected duplicate T"}
    end
  end

  def validate_ymd(ymd) do
    case String.split(ymd, "-") do
      [_, _, _, _ | _] ->
        {:error, "unexpected 4th section in y-m-d part"}

      [""] ->
        {:ok, Interval.zero()}

      ymd ->
        with {:ok, ymd} <- validate_all_integers(ymd) do
          {:ok,
           ymd
           |> Enum.zip(~w|years months days|a)
           |> Enum.map(&build_duration/1)
           |> Enum.reduce(Interval.zero(), &Interval.add/2)}
        end
    end
  end

  def validate_hms(nil), do: {:ok, Interval.zero()}

  def validate_hms(hms) do
    case String.split(hms, ":") do
      [_, _, _, _ | _] ->
        {:error, "unexpected 4th section in h:m:s part"}

      hms ->
        with {:ok, hm} <- validate_all_integers(Enum.take(hms, 2)),
             {:ok, s} <- validate_float(Enum.at(hms, 2)) do
          {:ok,
           (hm ++ List.wrap(s))
           |> Enum.zip(~w|hours minutes seconds|a)
           |> Enum.map(&build_duration/1)
           |> Enum.reduce(Interval.zero(), &Interval.add/2)}
        end
    end
  end

  defp validate_float(nil), do: {:ok, nil}

  defp validate_float(val) do
    case Float.parse(val) do
      {value, ""} -> {:ok, value}
      _ -> {:error, "invalid number `#{val}`"}
    end
  end

  defp validate_all_integers(list), do: Electric.Utils.map_while_ok(list, &cast_int/1)

  defp cast_int(int) do
    case Integer.parse(int) do
      {value, ""} -> {:ok, value}
      _ -> {:error, "invalid number `#{int}`"}
    end
  end

  defp build_duration({number, :years}), do: Interval.from_months(12 * number)
  defp build_duration({number, :months}), do: Interval.from_months(number)
  defp build_duration({number, :days}), do: Interval.from_days(number)
  defp build_duration({number, :hours}), do: Interval.from_hours(number)
  defp build_duration({number, :minutes}), do: Interval.from_minutes(number)
  defp build_duration({number, :seconds}), do: Interval.from_seconds(number)
end
