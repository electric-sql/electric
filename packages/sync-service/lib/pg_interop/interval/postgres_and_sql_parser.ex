defmodule PgInterop.Interval.PostgresAndSQLParser do
  @moduledoc """
  This module parses Postgres classic and SQL strings
  """
  alias PgInterop.Interval

  @parse_part_regexes [
    unmarked_end: ~r/(?<=\s|^)(?<second>(?:\+|-)?\s*\d+(?:\.\d+)?)(?=\s*$)/,
    microsecond:
      ~r/(?<=\s|^)(?<microsecond>(?:\+|-)?\s*\d+(?:\.\d+)?)\s*(?:us|usecs?|microseconds?)(?=\s|$)/,
    millisecond:
      ~r/(?<=\s|^)(?<millisecond>(?:\+|-)?\s*\d+(?:\.\d+)?)\s*(?:ms|msecs?|milliseconds?)(?=\s|$)/,
    second: ~r/(?<=\s|^)(?<second>(?:\+|-)?\s*\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)(?=\s|$)/,
    minute: ~r/(?<=\s|^)(?<minute>(?:\+|-)?\s*\d+(?:\.\d+)?)\s*(?:m|mins?|minutes?)(?=\s|$)/,
    hour: ~r/(?<=\s|^)(?<hour>(?:\+|-)?\s*\d+(?:\.\d+)?)\s*(?:h|hours?)(?=\s|$)/,
    day: ~r/(?<=\s|^)(?<day>(?:\+|-)?\s*\d+(?:\.\d+)?)\s*(?:d|days?)(?=\s|$)/,
    week: ~r/(?<=\s|^)(?<week>(?:\+|-)?\s*\d+(?:\.\d+)?)\s*(?:w|weeks?)(?=\s|$)/,
    month: ~r/(?<=\s|^)(?<month>(?:\+|-)?\s*\d+(?:\.\d+)?)\s*(?:m|mons?|months?)(?=\s|$)/,
    year: ~r/(?<=\s|^)(?<year>(?:\+|-)?\s*\d+(?:\.\d+)?)\s*(?:y|years?)(?=\s|$)/,
    decade: ~r/(?<=\s|^)(?<decade>(?:\+|-)?\s*\d+(?:\.\d+)?)\s*(?:decs?|decades?)(?=\s|$)/,
    century:
      ~r/(?<=\s|^)(?<century>(?:\+|-)?\s*\d+(?:\.\d+)?)\s*(?:c|cent|century|centuries)(?=\s|$)/,
    millennium:
      ~r/(?<=\s|^)(?<millennium>(?:\+|-)?\s*\d+(?:\.\d+)?)\s*(?:mils|millenniums)(?=\s|$)/,
    sql_ym: ~r/(?<=\s|^)(?<sign>\+|-)?\s*(?<year>\d+)-(?<month>\-?\d+)(?=\s|$)/,
    sql_dhm:
      ~r/(?<=\s|^)(?<day>(?:\+|-)?\s*\d+(?:\.\d+)?)?\s+(?<sign>\+|-)?\s*(?<hour>\d+):(?<minute>\d+)(?=\s|$)/,
    sql_dhms:
      ~r/(?<=\s|^)(?<day>(?:\+|-)?\s*\d+(?:\.\d+)?)?\s+(?<sign>\+|-)?\s*(?<hour>\d+):(?<minute>\d+):(?<second>\d+(?:\.\d+)?)(?=\s|$)/,
    sql_dms:
      ~r/(?<=\s|^)(?<day>(?:\+|-)?\s*\d+(?:\.\d+)?)?\s+(?<sign>\+|-)?\s*(?<minute>\d+):(?<second>\d+\.\d+)(?=\s|$)/
  ]

  @doc """
  Parses an Postgres classic and SQL formatted duration string into
  a Interval struct. The parse result is wrapped in a :ok/:error tuple.

  ## Examples

      iex> parse("1-2")
      {:ok, Interval.parse!("P1Y2M")}

      iex> parse("@ 1-2")
      {:ok, Interval.parse!("P1Y2M")}

      iex> parse("-1-2 +3 -4:05:06")
      {:ok, Interval.parse!("P-1Y-2M3DT-4H-5M-6S")}

      iex> parse("-1-2 -5:10.1")
      {:ok, Interval.parse!("P-1Y-2MT-5M-10.1S")}

      iex> parse("3 4:05:06")
      {:ok, Interval.parse!("P3DT4H5M6S")}

      iex> parse("1 year 2 months 3 days 4 hours 5 minutes 6 seconds")
      {:ok, Interval.parse!("P1Y2M3DT4H5M6S")}

      iex> parse("1 year 2-1 3 days +2")
      {:ok, Interval.parse!("P3Y1M3DT2S")}

      iex> parse("1 year 2-1 3 days -2")
      {:ok, Interval.parse!("P3Y1M3DT-2S")}

      iex> parse("1 year 2-1 3 days 2:2")
      {:ok, Interval.parse!("P3Y1M3DT2H2M")}

      iex> parse("1 year 2-1 3 days 2.2")
      {:ok, Interval.parse!("P3Y1M3DT2.2S")}

      iex> parse("-1-2 -5:10.1")
      {:ok, Interval.parse!("P-1Y-2MT-5M-10.1S")}

      iex> parse("1.3 cent 100-11 10.3")
      {:ok, Interval.parse!("P230Y11MT10.3S")}

      iex> parse("-   1 year -2 mons +3 days -  04:05:06")
      {:ok, Interval.parse!("P-1Y-2M3DT-4H-5M-6S")}

      iex> parse("0.1 mils 1 cent 1 decade 1 year 1 month 1 week 1 day 1 hour 1 minute 1 second 1000 ms 1000000 us")
      {:ok, Interval.parse!("P211Y1M8DT1H1M3S")}

      iex> parse("1.3 cent 100-11 10.3    1-1")
      {:error, "invalid input syntax at `10.3`"}

      iex> parse("10 10:01  1 10:01:10")
      {:error, "invalid input syntax"}
      iex> parse("1 month 1-10")
      {:error, "invalid input syntax"}
      iex> parse("1-13")
      {:error, "invalid input syntax"}
      iex> parse("1 minute 1 10:01:10")
      {:error, "invalid input syntax"}
      iex> parse("1 second 1 10:01:10")
      {:error, "invalid input syntax"}
      iex> parse("10 10:01 1")
      {:error, "invalid input syntax"}

      iex> parse("")
      {:error, "input string cannot be empty"}
  """
  @spec parse(String.t()) :: {:ok, Interval.t()} | {:error, term}
  def parse(<<>>), do: {:error, "input string cannot be empty"}

  def parse(<<?@, rest::binary>>), do: parse(rest)

  def parse(str) do
    {parsed_parts, rest} =
      Enum.map_reduce(@parse_part_regexes, str, fn {key, regex}, str ->
        {{key, Regex.named_captures(regex, str)}, Regex.replace(regex, str, "")}
      end)

    if String.trim(rest) == "" do
      with :ok <- validate_parts(Map.new(parsed_parts)) do
        {:ok,
         parsed_parts
         |> Enum.map(&apply_sign/1)
         |> Keyword.values()
         |> Enum.reject(&is_nil/1)
         |> Enum.flat_map(&Enum.map(&1, fn {k, v} -> build_duration(k, parse_float!(v)) end))
         |> Enum.reduce(Interval.zero(), &Interval.add/2)}
      end
    else
      {:error, "invalid input syntax at `#{String.trim(rest)}`"}
    end
  end

  defp apply_sign({k, %{"sign" => sign} = v}) when sign == "+" or sign == "",
    do: {k, Map.delete(v, "sign")}

  defp apply_sign({k, %{"sign" => "-"} = v}) do
    v =
      v
      |> Map.delete("sign")
      |> Map.new(fn
        {"day", _} = day -> day
        {part, val} -> {part, "-" <> val}
      end)

    {k, v}
  end

  defp apply_sign(no_sign), do: no_sign

  defp parse_float!(""), do: 0

  defp parse_float!(v) do
    prepared =
      case v do
        "+" <> number -> String.trim(number)
        "-" <> number -> "-" <> String.trim(number)
        number -> String.trim(number)
      end

    {float, ""} = Float.parse(prepared)
    float
  end

  defp validate_parts(%{sql_dhm: x, sql_dhms: y, sql_dms: z})
       when not is_nil(x) and not is_nil(y)
       when not is_nil(y) and not is_nil(z)
       when not is_nil(x) and not is_nil(z),
       do: {:error, "invalid input syntax"}

  @valid_months ~w|1 2 3 4 5 6 7 8 9 10 11 1|

  defp validate_parts(%{sql_ym: %{}, month: %{}}), do: {:error, "invalid input syntax"}

  defp validate_parts(%{sql_ym: %{"month" => mon}}) when mon not in @valid_months,
    do: {:error, "invalid input syntax"}

  defp validate_parts(%{minute: %{}, sql_dhm: x, sql_dhms: y, sql_dms: z})
       when not is_nil(x)
       when not is_nil(y)
       when not is_nil(z),
       do: {:error, "invalid input syntax"}

  defp validate_parts(%{second: %{}, sql_dhm: x, sql_dhms: y, sql_dms: z})
       when not is_nil(x)
       when not is_nil(y)
       when not is_nil(z),
       do: {:error, "invalid input syntax"}

  defp validate_parts(%{unmarked_end: %{}, sql_dhm: x, sql_dhms: y, sql_dms: z})
       when not is_nil(x)
       when not is_nil(y)
       when not is_nil(z),
       do: {:error, "invalid input syntax"}

  defp validate_parts(_), do: :ok

  defp build_duration("microsecond", number), do: Interval.from_microseconds(floor(number))
  defp build_duration("millisecond", number), do: Interval.from_milliseconds(number)
  defp build_duration("second", number), do: Interval.from_seconds(number)
  defp build_duration("minute", number), do: Interval.from_minutes(number)
  defp build_duration("hour", number), do: Interval.from_hours(number)
  defp build_duration("day", number), do: Interval.from_days(number)
  defp build_duration("week", number), do: Interval.from_weeks(number)
  defp build_duration("month", number), do: Interval.from_months(number)
  defp build_duration("year", number), do: Interval.from_months(12 * number)
  defp build_duration("decade", number), do: Interval.from_months(12 * 10 * number)
  defp build_duration("century", number), do: Interval.from_months(12 * 100 * number)
  defp build_duration("millennium", number), do: Interval.from_months(12 * 1000 * number)
end
