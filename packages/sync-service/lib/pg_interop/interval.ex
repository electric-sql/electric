defmodule PgInterop.Interval do
  @moduledoc """
  PostgreSQL interval representation.

  `Timex.Duration` does not match PG interval representation because it doesn't store month
  separately, leading to discrepancies like `date '2024-01-31' + interval '1 month'` being
  `datetime '2024-02-29 00:00:00` in Postgres, but `Timex.add(~N[2024-01-31 00:00:00],
  Timex.Duration.parse!("P1M"))` being `~N[2024-03-01 00:00:00]`. This implementation
  sticks to PG interpretation of the events.
  """

  alias __MODULE__

  defstruct months: 0, days: 0, microseconds: 0
  @type t :: %__MODULE__{months: integer(), days: integer(), microseconds: integer()}

  @doc """
  Format the interval in ISO8601 format.

  ## Examples

      iex> parse!("5 minutes 3d 4 hours 6") |> format()
      "P3DT4H5M6S"
  """
  def format(%Interval{} = interval), do: Interval.Iso8601Formatter.format(interval)

  @doc """
  Parse a PostgreSQL interval string, in any of the supported PostgreSQL input formats.

  For supported formats, see `parse!/1`
  """
  def parse(string) do
    with {:error, _} <- Interval.PostgresAndSQLParser.parse(string),
         {:error, _} <- Interval.ISO8601Parser.parse(string),
         {:error, _} <- Interval.ISO8601AlternativeParser.parse(string) do
      :error
    end
  end

  @doc """
  Parse a PostgreSQL interval string, in any of the supported PostgreSQL input formats.

  Raises an error when parsing fails, unlike `parse/1`

  ## Examples

  SQL standard format

      iex> parse!("1-2")
      Interval.parse!("P1Y2M")
      iex> parse!("3 4:05:06")
      Interval.parse!("P3DT4H5M6S")

      iex> parse!("5 minutes 3d 4 hours 6")
      Interval.parse!("P3DT4H5M6S")

  ISO8601 format

      iex> parse!("P1Y2M3DT4H5M6S")
      Interval.parse!("P1Y2M3DT4H5M6S")

  ISO8601 "alternative" format

      iex> parse!("P0001-02-03T04:05:06")
      Interval.parse!("P1Y2M3DT4H5M6S")

      iex> parse!("what")
      ** (RuntimeError) Not a valid PostgreSQL interval
  """
  def parse!(string) do
    case parse(string) do
      {:ok, value} -> value
      :error -> raise RuntimeError, message: "Not a valid PostgreSQL interval"
    end
  end

  @doc """
  Zero-length interval, useful in reductions
  """
  def zero(), do: %Interval{}

  @doc """
  Add two intervals together
  """
  def add(
        %Interval{months: m1, days: d1, microseconds: s1},
        %Interval{months: m2, days: d2, microseconds: s2}
      ),
      do: %Interval{months: m1 + m2, days: d1 + d2, microseconds: s1 + s2}

  @doc """
  Subtracts the second interval from the first one

  ## Examples

      iex> subtract(parse!("P2D"), parse!("P1D"))
      Interval.parse!("P1D")
  """
  def subtract(
        %Interval{months: m1, days: d1, microseconds: s1},
        %Interval{months: m2, days: d2, microseconds: s2}
      ),
      do: %Interval{months: m1 - m2, days: d1 - d2, microseconds: s1 - s2}

  @doc """
  Add the interval to a given `Date` or `NaiveDateTime`.

  ## Examples

      iex> add_to_time(~T[10:00:00], parse!("PT1H1M"))
      ~T[11:01:00.000000]
  """
  def add_to_time(%Time{} = time, %Interval{microseconds: us}),
    do: Time.add(time, us, :microsecond)

  @doc """
  Add the interval to a given `Date` or `NaiveDateTime`.

  ## Examples

      iex> add_to_date(~D[2024-01-01], parse!("P1D"))
      ~N[2024-01-02 00:00:00]

      iex> add_to_date(~N[2024-01-01 12:00:00], parse!("P1DT10M"))
      ~N[2024-01-02 12:10:00.000000]
  """
  def add_to_date(%Date{} = date, %Interval{} = interval),
    do: date |> NaiveDateTime.new!(~T[00:00:00]) |> add_to_date(interval)

  def add_to_date(%NaiveDateTime{} = date, %Interval{} = interval) do
    %NaiveDateTime{} =
      NaiveDateTime.shift(date,
        month: interval.months,
        day: interval.days,
        microsecond: {interval.microseconds, 6}
      )
  end

  @doc """
  Subtracts an interval from a given date or date-time to get a new date-time.

  Accepts `DateTime`, `NaiveDateTime`, and `Date`. Returns `DateTime` in the first case
  and `NaiveDateTime` in second  and third. If a plain `Date` is passed, midnight is assumed.

  ## Examples

      iex> subtract_from_date(~D[2024-01-10], parse!("P2DT12H"))
      ~N[2024-01-07 12:00:00.000000]

      iex> subtract_from_date(~N[2024-01-10 13:00:00], parse!("P2DT12H"))
      ~N[2024-01-08 01:00:00.000000]

      iex> subtract_from_date(~U[2024-01-10 13:00:00Z], parse!("P2DT12H"))
      ~U[2024-01-08 01:00:00.000000Z]
  """
  def subtract_from_date(%Date{} = date, %Interval{} = interval),
    do: date |> NaiveDateTime.new!(~T[00:00:00]) |> subtract_from_date(interval)

  def subtract_from_date(%m{} = date, %Interval{} = interval)
      when m in [DateTime, NaiveDateTime] do
    %^m{} =
      m.shift(date,
        month: -interval.months,
        day: -interval.days,
        microsecond: {-interval.microseconds, 6}
      )
  end

  @doc """
  Create an interval from specified amount of days.

  ## Examples

      iex> from_days(10)
      Interval.parse!("P10D")

      iex> from_days(10.5)
      Interval.parse!("P10DT12H")
  """
  def from_days(days) when is_integer(days), do: %Interval{days: days}

  def from_days(days) when is_float(days) do
    full_days = floor(days)
    %Interval{from_hours((days - full_days) * 24) | days: full_days}
  end

  @doc """
  Create an interval from specified amount of hours.

  ## Examples

      iex> from_hours(10)
      Interval.parse!("PT10H")
  """
  def from_hours(hours) when is_number(hours),
    do: %Interval{microseconds: round(hours * 3_600_000_000)}

  @doc """
  Create an interval from specified amount of microseconds.

  ## Examples

      iex> from_microseconds(1_000_000)
      Interval.parse!("PT1S")
  """
  def from_microseconds(microseconds) when is_integer(microseconds),
    do: %Interval{microseconds: microseconds}

  @doc """
  Create an interval from specified amount of milliseconds.

  ## Examples

      iex> from_milliseconds(1_000)
      Interval.parse!("PT1S")
  """
  def from_milliseconds(milliseconds) when is_number(milliseconds),
    do: %Interval{microseconds: round(milliseconds * 1000)}

  @doc """
  Create an interval from specified amount of seconds.

  ## Examples

      iex> from_seconds(60)
      Interval.parse!("PT1M")
  """
  def from_seconds(seconds) when is_number(seconds),
    do: %Interval{microseconds: round(seconds * 1_000_000)}

  @doc """
  Create an interval from specified amount of minutes.

  ## Examples

      iex> from_minutes(60.5)
      Interval.parse!("PT1H30S")
  """
  def from_minutes(minutes) when is_number(minutes),
    do: %Interval{microseconds: round(minutes * 60_000_000)}

  @doc """
  Create an interval from specified amount of weeks.

  ## Examples

      iex> from_weeks(4.2)
      Interval.parse!("P29DT9H36M")
  """
  def from_weeks(weeks) when is_number(weeks), do: from_days(7 * weeks)

  @doc """
  Create an interval from specified amount of months. Fractional
  months are counted as parts of 30 days.

  ## Examples

      iex> from_months(14.5)
      Interval.parse!("P1Y2M15D")
  """
  def from_months(months) do
    full_months = floor(months)
    %Interval{from_days((months - full_months) * 30) | months: full_months}
  end

  @doc """
  Create an interval from a time instance.

  ## Examples

      iex> from_time(~T[12:30:40.1])
      Interval.parse!("PT12H30M40.1S")

      iex> from_time(~T[12:30:40.000001])
      Interval.parse!("PT12H30M40.000001S")
  """
  def from_time(%Time{hour: h, minute: m, second: s, microsecond: {ms, _}}) do
    from_microseconds(ms + s * 1_000_000 + m * 60_000_000 + h * 3_600_000_000)
  end

  @doc """
  Scale an interval by a factor.

  ## Examples

      iex> scale(parse!("P2M4DT6H"), 1.5)
      Interval.parse!("P3M6DT9H")
  """
  def scale(%Interval{months: m, days: d, microseconds: ms}, by) when is_number(by) do
    from_microseconds(floor(ms * by))
    |> add(from_days(d * by))
    |> add(from_months(m * by))
  end

  @day_in_us 3_600_000_000 * 24

  @doc """
  Build an interval as a difference between DateTimes. Interval is positive when
  first datetime is greater than the second one.

  ## Examples

      iex> datetime_diff(~N[2024-01-02 00:10:00], ~N[2024-01-01 00:00:00])
      Interval.parse!("P1DT10M")

      iex> datetime_diff(~N[2024-01-02 00:00:00], ~N[2024-01-01 00:10:00])
      Interval.parse!("PT23H50M")

      iex> datetime_diff(~N[2024-01-02 00:00:00], ~N[2024-01-03 00:00:00])
      Interval.parse!("P-1D")

      iex> datetime_diff(DateTime.from_naive!(~N[2024-01-02 00:00:00], "Europe/Istanbul"), ~U[2024-01-02 00:00:00Z])
      Interval.parse!("PT-3H")
  """
  def datetime_diff(%NaiveDateTime{} = d1, %NaiveDateTime{} = d2) do
    %Interval{
      days: NaiveDateTime.diff(d1, d2, :day),
      microseconds: NaiveDateTime.diff(d1, d2, :microsecond) |> rem(@day_in_us)
    }
  end

  def datetime_diff(%DateTime{} = d1, %DateTime{} = d2) do
    %Interval{
      days: DateTime.diff(d1, d2, :day),
      microseconds: DateTime.diff(d1, d2, :microsecond) |> rem(@day_in_us)
    }
  end

  @doc """
  Move complete 24 hour periods from the microsecond portion of the interval to the day portion.
  """
  def justify_hours(%Interval{months: m, days: d, microseconds: us}) do
    %Interval{months: m, days: d + div(us, @day_in_us), microseconds: rem(us, @day_in_us)}
  end

  @doc """
  Move complete 30 day periods from the day portion of the interval to the month portion.
  """
  def justify_days(%Interval{months: m, days: d, microseconds: us}) do
    %Interval{months: m + div(d, 30), days: rem(d, 30), microseconds: us}
  end

  @doc """
  Move complete 24 hour periods from the microsecond portion of the interval to the day portion
  and complete 30 day periods from the day portion of the interval to the month portion.

  ## Examples
      iex> interval = %Interval{months: 0, days: 29, microseconds: #{@day_in_us} + 60_000_000}
      Interval.parse!("P29DT24H1M")
      iex> justify_interval(interval)
      Interval.parse!("P1MT1M")
  """
  def justify_interval(%Interval{} = i), do: i |> justify_hours() |> justify_days()
end

defimpl Inspect, for: PgInterop.Interval do
  def inspect(interval, _opts) do
    ~s|Interval.parse!("#{PgInterop.Interval.Iso8601Formatter.to_iodata(interval)}")|
  end
end
