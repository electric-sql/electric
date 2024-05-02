defmodule Electric.Replication.PostgresInterop.Casting do
  alias Electric.Utils
  @int2_range -32768..32767
  @int4_range -2_147_483_648..2_147_483_647
  @int8_range -9_223_372_036_854_775_808..9_223_372_036_854_775_807

  defguard is_pg_int2(x) when is_integer(x) and x in @int2_range
  defguard is_pg_int4(x) when is_integer(x) and x in @int4_range
  defguard is_pg_int8(x) when is_integer(x) and x in @int8_range

  def values_distinct?(nil, nil, _), do: false
  def values_distinct?(v1, v2, _) when is_nil(v1) or is_nil(v2), do: true
  def values_distinct?(_, _, plain_comparison), do: plain_comparison

  def values_not_distinct?(v1, v2, plain_comparison),
    do: not values_distinct?(v1, v2, plain_comparison)

  def parse_int2(input) do
    case String.to_integer(input) do
      x when is_pg_int2(x) -> x
    end
  end

  def parse_int4(input) do
    case String.to_integer(input) do
      x when is_pg_int4(x) -> x
    end
  end

  def parse_int8(input) do
    case String.to_integer(input) do
      x when is_pg_int8(x) -> x
    end
  end

  def parse_float8(input) do
    case Float.parse(input) do
      {value, ""} -> value
    end
  end

  def cast_bool(b) when is_binary(b), do: parse_bool(b)
  def cast_bool(b) when is_boolean(b), do: b

  # Yes, Postgres really allows all of these in `SELECT 'tru'::boolean`
  def parse_bool(x) when x in ~w|t tr tru true|, do: true
  def parse_bool(x) when x in ~w|f fa fal fals false|, do: false

  def parse_uuid(maybe_uuid) do
    {:ok, value} = Utils.validate_uuid(maybe_uuid)
    value
  end

  def parse_date("epoch"), do: Date.from_iso8601!("1970-01-01")

  def parse_date(maybe_date) do
    case Date.from_iso8601!(String.trim(maybe_date)) do
      # PG doesn't support years <= 0, so neither do we
      %Date{year: year} = date when year > 0 -> date
    end
  end

  def parse_time(maybe_time) do
    trimmed = maybe_time |> String.trim() |> String.upcase()

    case Time.from_iso8601(trimmed) do
      {:ok, time} ->
        time

      {:error, :invalid_format} ->
        parse_am_pm_time(trimmed)
    end
  end

  defp parse_am_pm_time(maybe_time) do
    case String.split_at(maybe_time, -2) do
      {time, x} when x in ["AM", "PM"] ->
        case {Time.from_iso8601!(String.trim(time)), x} do
          {%Time{hour: hour} = time, "AM"} when hour <= 12 -> time
          {%Time{hour: hour} = time, "PM"} when hour <= 12 -> Time.add(time, 12, :hour)
        end
    end
  end

  def parse_timestamp("epoch"), do: DateTime.from_unix!(0) |> DateTime.to_naive()

  def parse_timestamp(maybe_timestamp) do
    NaiveDateTime.from_iso8601!(maybe_timestamp)
  end

  def parse_timestamptz("epoch"), do: DateTime.from_unix!(0) |> DateTime.to_naive()

  def parse_timestamptz(maybe_timestamp) do
    {:ok, datetime, _} = DateTime.from_iso8601(maybe_timestamp)
    datetime
  end

  @doc """
  LIKE function from SQL. Case sensitive by default.

  ## Examples

      iex> like?("hello", "hell_")
      true

      iex> like?("helloo", "hell_")
      false

      iex> like?("helloo", "%o_")
      true

      iex> like?("HELLO", "hello")
      false

      iex> like?("HELLO", "hello", true)
      true
  """
  def like?(text, pattern, ignore_case? \\ false) do
    pattern
    |> String.split(~r/(?<!\\)[_%]/, include_captures: true, trim: true)
    |> Enum.map_join(fn
      "%" -> ".*"
      "_" -> "."
      text -> Regex.escape(text)
    end)
    |> then(&("^" <> &1 <> "$"))
    |> Regex.compile!(if ignore_case?, do: [:caseless], else: [])
    |> Regex.match?(text)
  end

  def ilike?(text, pattern), do: like?(text, pattern, true)
end
