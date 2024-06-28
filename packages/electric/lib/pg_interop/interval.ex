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
      #Interval<P1Y2M>
      iex> parse!("3 4:05:06")
      #Interval<P3DT4H5M6S>

      iex> parse!("5 minutes 3d 4 hours 6")
      #Interval<P3DT4H5M6S>

  ISO8601 format

      iex> parse!("P1Y2M3DT4H5M6S")
      #Interval<P1Y2M3DT4H5M6S>

  ISO8601 "alternative" format

      iex> parse!("P0001-02-03T04:05:06")
      #Interval<P1Y2M3DT4H5M6S>

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

  def subtract(
        %Interval{months: m1, days: d1, microseconds: s1},
        %Interval{months: m2, days: d2, microseconds: s2}
      ),
      do: %Interval{months: m1 - m2, days: d1 - d2, microseconds: s1 - s2}

  @doc """
  Add the interval to a given `Date` or `NaiveDateTime`.
  """
  def add_to_time(%Time{} = time, %Interval{microseconds: us}),
    do: Time.add(time, us, :microsecond)

  @doc """
  Add the interval to a given `Date` or `NaiveDateTime`.
  """
  def add_to_date(%Date{} = date, %Interval{} = interval),
    do: date |> NaiveDateTime.new!(~T[00:00:00]) |> add_to_date(interval)

  def add_to_date(%NaiveDateTime{} = date, %Interval{} = interval) do
    %NaiveDateTime{} =
      Timex.shift(date,
        months: interval.months,
        days: interval.days,
        microseconds: interval.microseconds
      )
  end

  def subtract_from_date(%Date{} = date, %Interval{} = interval),
    do: date |> NaiveDateTime.new!(~T[00:00:00]) |> subtract_from_date(interval)

  def subtract_from_date(%m{} = date, %Interval{} = interval)
      when m in [DateTime, NaiveDateTime] do
    %^m{} =
      Timex.shift(date,
        months: -interval.months,
        days: -interval.days,
        microseconds: -interval.microseconds
      )
  end

  def from_days(days) when is_integer(days), do: %Interval{days: days}

  def from_days(days) when is_float(days) do
    full_days = floor(days)
    %Interval{from_hours((days - full_days) * 24) | days: full_days}
  end

  def from_hours(hours) when is_number(hours),
    do: %Interval{microseconds: round(hours * 3_600_000_000)}

  def from_microseconds(microseconds) when is_integer(microseconds),
    do: %Interval{microseconds: microseconds}

  def from_milliseconds(milliseconds) when is_number(milliseconds),
    do: %Interval{microseconds: round(milliseconds * 1000)}

  def from_seconds(seconds) when is_number(seconds),
    do: %Interval{microseconds: round(seconds * 1_000_000)}

  def from_minutes(minutes) when is_number(minutes),
    do: %Interval{microseconds: round(minutes * 60_000_000)}

  def from_weeks(weeks) when is_number(weeks), do: from_days(7 * weeks)

  def from_months(months) do
    full_months = floor(months)
    %Interval{from_days((months - full_months) * 30) | months: full_months}
  end

  def from_time(%Time{hour: h, minute: m, second: s, microsecond: ms}) do
    from_microseconds(ms + s * 1_000_000 + m * 60_000_000 + h * 3_600_000_000)
  end

  def scale(%Interval{months: m, days: d, microseconds: ms}, by) when is_number(by) do
    from_microseconds(ms * by)
    |> add(from_days(d * by))
    |> add(from_months(m * by))
  end

  @day_in_us 3_600_000_000 * 24

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

  def justify_hours(%Interval{months: m, days: d, microseconds: us}) do
    %Interval{months: m, days: d + div(us, @day_in_us), microseconds: rem(us, @day_in_us)}
  end

  def justify_days(%Interval{months: m, days: d, microseconds: us}) do
    %Interval{months: m + div(d, 30), days: rem(d, 30), microseconds: us}
  end

  def justify_interval(%Interval{} = i), do: i |> justify_hours() |> justify_days()
end

defimpl Inspect, for: PgInterop.Interval do
  def inspect(interval, _opts) do
    ~s|#Interval<#{PgInterop.Interval.Iso8601Formatter.to_iodata(interval)}>|
  end
end
