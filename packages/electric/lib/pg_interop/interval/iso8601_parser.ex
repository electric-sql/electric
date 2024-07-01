defmodule PgInterop.Interval.ISO8601Parser do
  @moduledoc """
  This module parses ISO-8601 duration strings into Interval structs.

  Implementation taken from https://github.com/bitwalker/timex/blob/3.7.9/lib/parse/duration/parsers/iso8601.ex
  and adapted to fill a different structure + support negatives.
  """
  alias PgInterop.Interval

  @numeric ~c"-.0123456789"

  @doc """
  Parses an ISO-8601 formatted duration string into a Interval struct.
  The parse result is wrapped in a :ok/:error tuple.

  ## Examples

      iex> {:ok, d} = #{__MODULE__}.parse("P15Y3M2DT1H14M37.25S")
      ...> #{Interval}.Iso8601Formatter.format(d)
      "P15Y3M2DT1H14M37.25S"

      iex> {:ok, d} = #{__MODULE__}.parse("P15Y3M2D")
      ...> #{Interval}.Iso8601Formatter.format(d)
      "P15Y3M2D"

      iex> {:ok, d} = #{__MODULE__}.parse("PT3H12M25.001S")
      ...> #{Interval}.Iso8601Formatter.format(d)
      "PT3H12M25.001S"

      iex> {:ok, d} = #{__MODULE__}.parse("P2W")
      ...> #{Interval}.Iso8601Formatter.format(d)
      "P14D"

      iex> #{__MODULE__}.parse("P15YT3D")
      {:error, "invalid use of date component after time separator"}

  """
  @spec parse(String.t()) :: {:ok, Interval.t()} | {:error, term}
  def parse(<<>>), do: {:error, "input string cannot be empty"}

  def parse(<<?P, rest::binary>>) do
    case parse_components(rest, []) do
      {:error, _} = err ->
        err

      [{?W, w}] ->
        {:ok, Interval.from_days(7 * w)}

      components when is_list(components) ->
        result =
          Enum.reduce(components, {false, Interval.zero()}, fn
            _, {:error, _} = err ->
              err

            {?Y, y}, {false, d} ->
              {false, Interval.add(d, Interval.from_months(12 * y))}

            {?M, m}, {false, d} ->
              {false, Interval.add(d, Interval.from_months(m))}

            {?D, dd}, {false, d} ->
              {false, Interval.add(d, Interval.from_days(dd))}

            ?T, {false, d} ->
              {true, d}

            ?T, {true, _d} ->
              {:error, "encountered duplicate time separator T"}

            {?H, h}, {true, d} ->
              {true, Interval.add(d, Interval.from_hours(h))}

            {?M, m}, {true, d} ->
              {true, Interval.add(d, Interval.from_minutes(m))}

            {?S, s}, {true, d} ->
              {true, Interval.add(d, Interval.from_seconds(s))}

            {?W, _w}, {_, _} ->
              {:error,
               "Found 'W', a basic format designator, but the parse indicates " <>
                 "this is an extended format, mixing the two formats is disallowed"}

            {unit, _}, {true, _d} when unit in [?Y, ?D] ->
              {:error, "invalid use of date component after time separator"}

            {unit, _}, {false, _d} when unit in [?H, ?S] ->
              {:error, "missing T separator between date and time components"}
          end)

        case result do
          {:error, _} = err -> err
          {_, duration} -> {:ok, duration}
        end
    end
  end

  def parse(<<c::utf8, _::binary>>), do: {:error, "expected P, got #{<<c::utf8>>}"}
  def parse(s) when is_binary(s), do: {:error, "unexpected end of input"}

  @spec parse_components(binary, [{integer, number}]) ::
          [{integer, number}] | {:error, String.t()}
  defp parse_components(<<>>, acc),
    do: Enum.reverse(acc)

  defp parse_components(<<?T>>, _acc),
    do: {:error, "unexpected end of input at T"}

  defp parse_components(<<?T, rest::binary>>, acc),
    do: parse_components(rest, [?T | acc])

  defp parse_components(<<c::utf8>>, _acc) when c in @numeric,
    do: {:error, "unexpected end of input at #{<<c::utf8>>}"}

  defp parse_components(<<c::utf8, rest::binary>>, acc) when c in @numeric do
    case parse_component(rest, {:integer, <<c::utf8>>}) do
      {:error, _} = err -> err
      {u, n, rest} -> parse_components(rest, [{u, n} | acc])
    end
  end

  defp parse_components(<<c::utf8>>, _acc),
    do: {:error, "unexpected end of input at #{<<c::utf8>>}"}

  defp parse_components(<<c::utf8, _::binary>>, _acc),
    do: {:error, "expected numeric, but got #{<<c::utf8>>}"}

  @spec parse_component(binary, {:float | :integer, binary}) ::
          {integer, number, binary} | {:error, msg :: binary()}
  defp parse_component(<<c::utf8>>, _acc) when c in @numeric,
    do: {:error, "unexpected end of input at #{<<c::utf8>>}"}

  defp parse_component(<<c::utf8>>, {type, acc}) when c in ~c"WYMDHS" do
    case cast_number(type, acc) do
      {n, _} -> {c, n, <<>>}
      :error -> {:error, "invalid number `#{acc}`"}
    end
  end

  defp parse_component(<<".", rest::binary>>, {:integer, acc}) do
    parse_component(rest, {:float, <<acc::binary, ".">>})
  end

  defp parse_component(<<c::utf8, rest::binary>>, {:integer, acc}) when c in @numeric do
    parse_component(rest, {:integer, <<acc::binary, c::utf8>>})
  end

  defp parse_component(<<c::utf8, rest::binary>>, {:float, acc}) when c in @numeric do
    parse_component(rest, {:float, <<acc::binary, c::utf8>>})
  end

  defp parse_component(<<c::utf8, rest::binary>>, {type, acc}) when c in ~c"WYMDHS" do
    case cast_number(type, acc) do
      {n, _} -> {c, n, rest}
      :error -> {:error, "invalid number `#{acc}`"}
    end
  end

  defp parse_component(<<c::utf8>>, _acc), do: {:error, "unexpected token #{<<c::utf8>>}"}

  defp parse_component(<<c::utf8, _::binary>>, _acc),
    do: {:error, "unexpected token #{<<c::utf8>>}"}

  @spec cast_number(:float | :integer, binary) :: {number(), binary()} | :error
  defp cast_number(:integer, binary), do: Integer.parse(binary)
  defp cast_number(:float, binary), do: Float.parse(binary)
end
