defmodule Electric.Replication.PostgresInterop.Casting do
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

  # Yes, Postgres really allows all of these in `SELECT 'tru'::boolean`
  def parse_bool(x) when x in ~w|t tr tru true|, do: true
  def parse_bool(x) when x in ~w|f fa fal fals false|, do: false

  def parse_uuid(maybe_uuid) do
    {:ok, value} = Ecto.UUID.dump(maybe_uuid)
    value
  end

  def uuid_to_string(maybe_uuid) do
    {:ok, uuid} = Ecto.UUID.cast(maybe_uuid)
    uuid
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

  Follows Postgres semantics:

    * `%` matches any sequence of zero or more characters,
    * `_` matches any single character,
    * both wildcards also match newline characters,
    * the pattern must match the entire string (a trailing newline in the value
      is not ignored), and
    * a backslash escapes the following character, so an escaped `%` or `_`
      matches the literal character instead of acting as a wildcard.

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
    # `:dotall` makes `.` (from `%`/`_`) match newlines like Postgres does, and
    # `\A..\z` anchors the match to the absolute string boundaries so a trailing
    # newline in the value is not silently ignored (which `^..$` would do).
    options = if ignore_case?, do: [:caseless, :dotall], else: [:dotall]

    ("\\A" <> like_pattern_to_regex(pattern) <> "\\z")
    |> Regex.compile!(options)
    |> Regex.match?(text)
  end

  # Translate a SQL LIKE pattern into a regex source string following Postgres
  # semantics: `%` -> `.*`, `_` -> `.`, a backslash escapes the next character,
  # and everything else is matched literally.
  defp like_pattern_to_regex(pattern), do: like_pattern_to_regex(pattern, [])

  defp like_pattern_to_regex(<<>>, acc),
    do: acc |> Enum.reverse() |> IO.iodata_to_binary()

  defp like_pattern_to_regex(<<?\\, next::utf8, rest::binary>>, acc),
    do: like_pattern_to_regex(rest, [Regex.escape(<<next::utf8>>) | acc])

  defp like_pattern_to_regex(<<?%, rest::binary>>, acc),
    do: like_pattern_to_regex(rest, [".*" | acc])

  defp like_pattern_to_regex(<<?_, rest::binary>>, acc),
    do: like_pattern_to_regex(rest, ["." | acc])

  defp like_pattern_to_regex(<<c::utf8, rest::binary>>, acc),
    do: like_pattern_to_regex(rest, [Regex.escape(<<c::utf8>>) | acc])

  def ilike?(text, pattern), do: like?(text, pattern, true)

  @doc """
  The Postgres OR operator, which has some specific behaviour when
  comparing NULLs with booleans.

  ## Examples

      iex> pg_or(true, false)
      true

      iex> pg_or(false, false)
      false

      iex> pg_or(nil, true)
      true

      iex> pg_or(nil, false)
      nil

      iex> pg_or(nil, nil)
      nil
  """
  @spec pg_or(boolean() | nil, boolean() | nil) :: boolean() | nil
  def pg_or(a, b)
  def pg_or(nil, true), do: true
  def pg_or(nil, _), do: nil
  def pg_or(true, nil), do: true
  def pg_or(_, nil), do: nil
  def pg_or(a, b), do: Kernel.or(a, b)

  @doc """
  The Postgres AND operator, which has some specific behaviour when
  comparing NULLs with booleans.

  ## Examples

      iex> pg_and(true, true)
      true

      iex> pg_and(true, false)
      false

      iex> pg_and(false, false)
      false

      iex> pg_and(nil, true)
      nil

      iex> pg_and(nil, false)
      false

      iex> pg_and(nil, nil)
      nil
  """
  @spec pg_and(boolean() | nil, boolean() | nil) :: boolean() | nil
  def pg_and(a, b)
  def pg_and(nil, false), do: false
  def pg_and(nil, _), do: nil
  def pg_and(false, nil), do: false
  def pg_and(_, nil), do: nil
  def pg_and(a, b), do: Kernel.and(a, b)
end
