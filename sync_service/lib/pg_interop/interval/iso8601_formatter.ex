defmodule PgInterop.Interval.Iso8601Formatter do
  alias PgInterop.Interval

  @hour 3_600_000_000
  @minute 60_000_000
  @second 1_000_000

  @doc """
    Return a human readable string representing the duration, formatted according
    to ISO8601. Negative sections will be formatted accordingly, as does PG.

    ## Examples

        iex> #{Interval}.parse("PT2S") |> #{__MODULE__}.format
        "PT2S"

        iex> #{Interval}.parse("PT2.0001S") |> #{__MODULE__}.format
        "PT2.0001S"

        iex> #{Interval}.parse("PT1M5S") |> #{__MODULE__}.format
        "PT1M5S"

        iex> #{Interval}.parse("PT1M5S") |> #{__MODULE__}.format
        "PT1M5S"

        iex> #{Interval}.parse("P45Y6M5DT21H12M34.590264S") |> #{__MODULE__}.format
        "P45Y6M5DT21H12M34.590264S"

        iex> #{Interval}.parse("PT0S") |> #{__MODULE__}.format
        "PT0S"
  """
  def format(%Interval{} = interval), do: IO.iodata_to_binary(to_iodata(interval))

  @doc false
  def to_iodata(%Interval{months: 0, days: 0, microseconds: 0}), do: "PT0S"

  def to_iodata(%Interval{months: months, days: days, microseconds: us}) do
    [
      ?P,
      format_months(months),
      format_days(days),
      format_time(us)
    ]
  end

  defp format_months(months),
    do: [suffix_nonzero(div(months, 12), ?Y), suffix_nonzero(rem(months, 12), ?M)]

  defp format_days(days), do: suffix_nonzero(days, ?D)
  defp format_time(0), do: []

  defp format_time(time),
    do: [
      ?T,
      suffix_nonzero(div(time, @hour), ?H),
      suffix_nonzero(div(rem(time, @hour), @minute), ?M),
      format_seconds(rem(time, @minute))
    ]

  defp format_seconds(0), do: []

  defp format_seconds(us) when rem(us, @second) == 0,
    do: [Integer.to_charlist(div(us, @second)), ?S]

  defp format_seconds(us), do: [Float.to_charlist(us / 100_000_0.0), ?S]

  defp suffix_nonzero(0, _), do: []
  defp suffix_nonzero(x, suffix), do: [Integer.to_charlist(x), suffix]
end
